import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { writeAuditLog } from '../../audit/audit-logger.js';
import { UnauthorizedError, ForbiddenError, ConflictError, NotFoundError, AppError } from '../../middleware/errors.js';
import { loadDek } from '../../crypto/dek-store.js';
import { decryptField, decryptOptionalField, searchHash, zeroize } from '../../crypto/field-encryption.js';
import { hashPassword, verifyPassword, generateSecureToken, hashToken } from '../auth/password.service.js';
import { signPortalAccessToken } from './portal.token.service.js';

export interface StaffActor {
  id: string;
  email: string;
}
export interface RequestMeta {
  requestId: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

// ── Tạo tài khoản (nhân viên thực hiện) ───────────────────────────────

/**
 * Nhân viên (portal:manage) tạo tài khoản cổng cho bệnh nhân. Sinh mật khẩu
 * tạm, trả về MỘT LẦN (production: gửi qua kênh an toàn thay vì trả thẳng).
 * Bệnh nhân buộc đổi mật khẩu ở lần đăng nhập đầu.
 */
export async function createAccount(
  patientId: string,
  loginEmail: string,
  actor: StaffActor,
  meta: RequestMeta,
): Promise<{ tempPassword: string; loginEmail: string }> {
  const patient = await db
    .selectFrom('patients')
    .select('id')
    .where('id', '=', patientId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!patient) throw new NotFoundError('Bệnh nhân');

  const existing = await db
    .selectFrom('patient_portal_accounts')
    .select('id')
    .where('patient_id', '=', patientId)
    .executeTakeFirst();
  if (existing) throw new ConflictError('Bệnh nhân đã có tài khoản cổng');

  const emailHash = searchHash(loginEmail);
  const emailTaken = await db
    .selectFrom('patient_portal_accounts')
    .select('id')
    .where('login_email_hash', '=', emailHash)
    .executeTakeFirst();
  if (emailTaken) throw new ConflictError('Email đăng nhập đã được dùng cho tài khoản khác');

  const tempPassword = 'BN-' + generateSecureToken(9); // ~12 ký tự, đủ mạnh
  const passwordHash = await hashPassword(tempPassword);

  await db.transaction().execute(async (trx) => {
    const acc = await trx
      .insertInto('patient_portal_accounts')
      .values({
        patient_id: patientId,
        login_email_hash: emailHash,
        password_hash: passwordHash,
        created_by: actor.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PORTAL_ACCOUNT_CREATE',
      entityType: 'patient',
      entityId: patientId,
      changes: { portalAccountId: { old: null, new: acc.id } },
      ipAddress: meta.ipAddress,
    });
  });

  return { tempPassword, loginEmail };
}

// ── Đăng nhập bệnh nhân ───────────────────────────────────────────────

export interface PortalAuthSuccess {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  mustChangePassword: boolean;
  patient: PortalPatientDto;
}

const INVALID = () => new UnauthorizedError('Email hoặc mật khẩu không đúng');

export async function login(email: string, password: string, meta: RequestMeta): Promise<PortalAuthSuccess> {
  const account = await db
    .selectFrom('patient_portal_accounts')
    .select(['id', 'patient_id', 'password_hash', 'status', 'failed_login_attempts', 'locked_until', 'must_change_password'])
    .where('login_email_hash', '=', searchHash(email))
    .executeTakeFirst();

  if (!account) {
    // Vẫn hash một lần để thời gian phản hồi không tiết lộ email có tồn tại không.
    await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$aGFzaA', password);
    throw INVALID();
  }

  if (account.locked_until && account.locked_until.getTime() > Date.now()) {
    throw new AppError('Tài khoản đang bị khoá tạm thời, vui lòng thử lại sau', 423, 'ACCOUNT_LOCKED');
  }
  if (account.status !== 'active') throw new ForbiddenError('Tài khoản đã bị vô hiệu hoá');

  if (!(await verifyPassword(account.password_hash, password))) {
    const attempts = account.failed_login_attempts + 1;
    const lock = attempts >= env.MAX_LOGIN_ATTEMPTS;
    await db
      .updateTable('patient_portal_accounts')
      .set({ failed_login_attempts: attempts, locked_until: lock ? new Date(Date.now() + env.ACCOUNT_LOCK_MINUTES * 60_000) : null })
      .where('id', '=', account.id)
      .execute();
    throw INVALID();
  }

  const refreshToken = generateSecureToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('patient_portal_sessions')
      .values({
        portal_account_id: account.id,
        refresh_token_hash: hashToken(refreshToken),
        expires_at: expiresAt,
        ip_address: meta.ipAddress ?? null,
        user_agent: meta.userAgent ?? null,
      })
      .execute();

    await trx
      .updateTable('patient_portal_accounts')
      .set({ failed_login_attempts: 0, locked_until: null, last_login_at: new Date() })
      .where('id', '=', account.id)
      .execute();

    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorEmail: `portal:${account.id}`,
      action: 'PORTAL_LOGIN',
      entityType: 'patient',
      entityId: account.patient_id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  });

  return {
    accessToken: signPortalAccessToken({ portalAccountId: account.id, patientId: account.patient_id }),
    refreshToken,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    mustChangePassword: account.must_change_password,
    patient: await loadPatientDto(account.patient_id),
  };
}

export async function refresh(refreshToken: string, _meta: RequestMeta): Promise<PortalAuthSuccess> {
  const session = await db
    .selectFrom('patient_portal_sessions')
    .innerJoin('patient_portal_accounts as a', 'a.id', 'patient_portal_sessions.portal_account_id')
    .select([
      'patient_portal_sessions.id as session_id',
      'patient_portal_sessions.expires_at',
      'patient_portal_sessions.revoked_at',
      'patient_portal_sessions.last_activity_at',
      'a.id as account_id',
      'a.patient_id',
      'a.status',
      'a.must_change_password',
    ])
    .where('patient_portal_sessions.refresh_token_hash', '=', hashToken(refreshToken))
    .executeTakeFirst();

  if (!session || session.revoked_at || session.expires_at.getTime() < Date.now()) {
    throw new UnauthorizedError('Phiên đăng nhập không hợp lệ');
  }
  if (Date.now() - session.last_activity_at.getTime() > env.SESSION_IDLE_TIMEOUT_SECONDS * 1000) {
    await db.updateTable('patient_portal_sessions').set({ revoked_at: new Date(), revoked_reason: 'idle_timeout' }).where('id', '=', session.session_id).execute();
    throw new UnauthorizedError('Phiên đăng nhập hết hạn do không hoạt động');
  }
  if (session.status !== 'active') throw new ForbiddenError('Tài khoản đã bị vô hiệu hoá');

  const newRefresh = generateSecureToken();
  await db
    .updateTable('patient_portal_sessions')
    .set({ refresh_token_hash: hashToken(newRefresh), expires_at: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000), last_activity_at: new Date() })
    .where('id', '=', session.session_id)
    .execute();

  return {
    accessToken: signPortalAccessToken({ portalAccountId: session.account_id, patientId: session.patient_id }),
    refreshToken: newRefresh,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    mustChangePassword: session.must_change_password,
    patient: await loadPatientDto(session.patient_id),
  };
}

export async function logout(portalAccountId: string, meta: RequestMeta): Promise<void> {
  await db
    .updateTable('patient_portal_sessions')
    .set({ revoked_at: new Date(), revoked_reason: 'logout' })
    .where('portal_account_id', '=', portalAccountId)
    .where('revoked_at', 'is', null)
    .execute();
  await db.transaction().execute((trx) =>
    writeAuditLog(trx, { requestId: meta.requestId, actorEmail: `portal:${portalAccountId}`, action: 'PORTAL_LOGOUT', ipAddress: meta.ipAddress }),
  );
}

export async function changePassword(
  portalAccountId: string,
  currentPassword: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<void> {
  const account = await db
    .selectFrom('patient_portal_accounts')
    .select(['id', 'password_hash'])
    .where('id', '=', portalAccountId)
    .executeTakeFirstOrThrow();

  if (!(await verifyPassword(account.password_hash, currentPassword))) {
    throw new UnauthorizedError('Mật khẩu hiện tại không đúng');
  }

  await db
    .updateTable('patient_portal_accounts')
    .set({ password_hash: await hashPassword(newPassword), must_change_password: false })
    .where('id', '=', portalAccountId)
    .execute();

  // Đổi mật khẩu → thu hồi mọi phiên khác (buộc đăng nhập lại).
  await db.updateTable('patient_portal_sessions').set({ revoked_at: new Date(), revoked_reason: 'password_changed' }).where('portal_account_id', '=', portalAccountId).where('revoked_at', 'is', null).execute();

  await db.transaction().execute((trx) =>
    writeAuditLog(trx, { requestId: meta.requestId, actorEmail: `portal:${portalAccountId}`, action: 'PORTAL_PASSWORD_CHANGE', ipAddress: meta.ipAddress }),
  );
}

// ── Dữ liệu của CHÍNH bệnh nhân ──────────────────────────────────────

export interface PortalPatientDto {
  mrn: string;
  fullName: string;
  dob: string;
  email: string | null;
  phone: string | null;
}

async function loadPatientDto(patientId: string): Promise<PortalPatientDto> {
  const p = await db
    .selectFrom('patients')
    .select(['mrn', 'first_name_enc', 'last_name_enc', 'dob_enc', 'email_enc', 'phone_enc', 'dek_id'])
    .where('id', '=', patientId)
    .executeTakeFirstOrThrow();
  const dek = await loadDek(db, p.dek_id);
  try {
    return {
      mrn: p.mrn,
      fullName: `${decryptField(p.first_name_enc, dek)} ${decryptField(p.last_name_enc, dek)}`.trim(),
      dob: decryptField(p.dob_enc, dek),
      email: decryptOptionalField(p.email_enc, dek),
      phone: decryptOptionalField(p.phone_enc, dek),
    };
  } finally {
    zeroize(dek);
  }
}

export async function getMe(patientId: string): Promise<PortalPatientDto> {
  return loadPatientDto(patientId);
}

export async function getAppointments(patientId: string) {
  const rows = await db
    .selectFrom('appointments as a')
    .innerJoin('users as d', 'd.id', 'a.doctor_id')
    .select(['a.id', 'a.scheduled_start', 'a.scheduled_end', 'a.status', 'a.room', 'd.full_name as doctor_name'])
    .where('a.patient_id', '=', patientId)
    .orderBy('a.scheduled_start', 'desc')
    .execute();
  // KHÔNG trả reason (lý do khám) — bệnh nhân biết lý do rồi, và giữ payload gọn.
  return rows.map((r) => ({
    id: r.id,
    scheduledStart: r.scheduled_start,
    scheduledEnd: r.scheduled_end,
    status: r.status,
    room: r.room,
    doctorName: r.doctor_name,
  }));
}

export async function getPrescriptions(patientId: string) {
  const rows = await db
    .selectFrom('prescriptions')
    .innerJoin('patients as p', 'p.id', 'prescriptions.patient_id')
    .select([
      'prescriptions.id',
      'prescriptions.medication',
      'prescriptions.dosage',
      'prescriptions.frequency',
      'prescriptions.duration_days',
      'prescriptions.instructions_enc',
      'prescriptions.status',
      'prescriptions.prescribed_at',
      'p.dek_id',
    ])
    .where('prescriptions.patient_id', '=', patientId)
    .orderBy('prescriptions.prescribed_at', 'desc')
    .execute();

  if (rows.length === 0) return [];
  const dek = await loadDek(db, rows[0]!.dek_id);
  try {
    return rows.map((r) => ({
      id: r.id,
      medication: r.medication,
      dosage: r.dosage,
      frequency: r.frequency,
      durationDays: r.duration_days,
      instructions: decryptOptionalField(r.instructions_enc, dek),
      status: r.status,
      prescribedAt: r.prescribed_at,
    }));
  } finally {
    zeroize(dek);
  }
}
