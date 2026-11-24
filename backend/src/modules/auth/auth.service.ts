import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { writeAuditLog } from '../../audit/audit-logger.js';
import { UnauthorizedError, ForbiddenError, AppError, ConflictError } from '../../middleware/errors.js';
import { createDek, loadDek } from '../../crypto/dek-store.js';
import { encryptField, decryptField, zeroize } from '../../crypto/field-encryption.js';
import * as repo from './auth.repository.js';
import { verifyPassword, hashPassword, needsRehash, generateSecureToken, hashToken } from './password.service.js';
import {
  signAccessToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
  signEnrollmentToken,
  verifyEnrollmentToken,
} from './token.service.js';
import {
  generateMfaSecret,
  buildOtpAuthUrl,
  verifyTotpStep,
  generateRecoveryCodes,
  matchRecoveryCode,
} from './mfa.service.js';

export interface RequestMeta {
  requestId: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  permissions: string[];
}

export interface AuthSuccess {
  kind: 'authenticated';
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: CurrentUser;
}

export interface MfaChallenge {
  kind: 'mfa_required';
  mfaToken: string;
}

export interface MfaEnrollmentRequired {
  kind: 'mfa_enrollment_required';
  enrollmentToken: string;
}

/** Ném lỗi giống hệt nhau cho "email sai" và "mật khẩu sai" — không tiết lộ email nào tồn tại. */
const INVALID_CREDENTIALS = () => new UnauthorizedError('Email hoặc mật khẩu không đúng');

export async function login(
  input: { email: string; password: string },
  meta: RequestMeta,
): Promise<AuthSuccess | MfaChallenge | MfaEnrollmentRequired> {
  const user = await repo.findUserByEmail(input.email);

  if (!user) {
    // Vẫn hash một lần để thời gian phản hồi không tiết lộ email có tồn tại hay không.
    await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$aGFzaA', input.password);
    await db.transaction().execute((trx) =>
      writeAuditLog(trx, {
        requestId: meta.requestId,
        action: 'LOGIN_FAILED',
        outcome: 'failure',
        reason: 'unknown_email',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      }),
    );
    throw INVALID_CREDENTIALS();
  }

  if (user.locked_until && user.locked_until.getTime() > Date.now()) {
    await auditFor(user, 'LOGIN_BLOCKED', 'denied', 'account_locked', meta);
    throw new AppError('Tài khoản đang bị khoá tạm thời, vui lòng thử lại sau', 423, 'ACCOUNT_LOCKED');
  }

  if (user.status !== 'active') {
    await auditFor(user, 'LOGIN_BLOCKED', 'denied', `status_${user.status}`, meta);
    throw new ForbiddenError('Tài khoản đã bị vô hiệu hoá');
  }

  if (!(await verifyPassword(user.password_hash, input.password))) {
    const { locked } = await repo.recordFailedLogin(user.id, env.MAX_LOGIN_ATTEMPTS, env.ACCOUNT_LOCK_MINUTES);
    await auditFor(user, 'LOGIN_FAILED', 'failure', locked ? 'bad_password_locked' : 'bad_password', meta);
    throw INVALID_CREDENTIALS();
  }

  // Nâng cấp hash nếu tham số Argon2 đã đổi kể từ lần đặt mật khẩu trước.
  if (needsRehash(user.password_hash)) {
    const upgraded = await hashPassword(input.password);
    await db.updateTable('users').set({ password_hash: upgraded }).where('id', '=', user.id).execute();
  }

  if (user.mfa_enabled) {
    await auditFor(user, 'LOGIN_MFA_CHALLENGE', 'success', undefined, meta);
    return { kind: 'mfa_required', mfaToken: signMfaChallengeToken(user.id) };
  }

  if (env.MFA_REQUIRED) {
    // Mật khẩu đã đúng nhưng chưa có MFA. Cấp enrollment token để người dùng
    // đăng ký TOTP — không có bước này thì tài khoản mới sẽ bị kẹt vĩnh viễn.
    await auditFor(user, 'LOGIN_MFA_ENROLLMENT_REQUIRED', 'success', undefined, meta);
    return { kind: 'mfa_enrollment_required', enrollmentToken: signEnrollmentToken(user.id) };
  }

  return issueSession(user.id, user.role_id, meta, 'LOGIN_SUCCESS');
}

export async function verifyMfa(input: { mfaToken: string; code: string }, meta: RequestMeta): Promise<AuthSuccess> {
  const userId = readMfaToken(input.mfaToken);
  const record = await repo.findMfaSecret(userId);
  if (!record) throw new UnauthorizedError('Tài khoản chưa thiết lập MFA');

  const dek = await loadDek(db, record.dek_id);
  let secret: string;
  try {
    secret = decryptField(record.secret_enc, dek);
  } finally {
    zeroize(dek);
  }

  const step = verifyTotpStep(secret, input.code);
  // Cùng một thông báo lỗi cho "mã sai" và "mã đúng nhưng đã dùng rồi" — nếu
  // phân biệt hai trường hợp, kẻ tấn công cầm một mã bắt được (quay màn hình,
  // nhìn trộm) sẽ biết ngay mã đó còn "sống" hay đã bị chủ tài khoản dùng mất,
  // tức là biến lỗi thành kênh dò thời điểm nạn nhân đăng nhập.
  const claimed = step !== null && (await repo.claimTotpStep(db, userId, step));

  if (!claimed) {
    const user = await repo.findUserById(userId);
    await db.transaction().execute((trx) =>
      writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: userId,
        actorEmail: user?.email,
        action: 'MFA_FAILED',
        outcome: 'failure',
        reason: step === null ? 'invalid_code' : 'replayed_code',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      }),
    );
    throw new UnauthorizedError('Mã xác thực không đúng hoặc đã hết hạn');
  }

  const user = await db
    .selectFrom('users')
    .select(['id', 'role_id'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();

  return issueSession(user.id, user.role_id, meta, 'LOGIN_SUCCESS');
}

export async function verifyRecoveryCode(
  input: { mfaToken: string; recoveryCode: string },
  meta: RequestMeta,
): Promise<AuthSuccess> {
  const userId = readMfaToken(input.mfaToken);
  const record = await repo.findMfaSecret(userId);
  if (!record) throw new UnauthorizedError('Tài khoản chưa thiết lập MFA');

  const matched = matchRecoveryCode(input.recoveryCode, record.recovery_codes_hashed);
  if (!matched) {
    throw new UnauthorizedError('Mã khôi phục không hợp lệ');
  }

  const remaining = record.recovery_codes_hashed.filter((c) => c !== matched);
  const user = await db
    .selectFrom('users')
    .select(['id', 'role_id'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();

  return issueSession(user.id, user.role_id, meta, 'LOGIN_RECOVERY_CODE', async (trx) => {
    await repo.consumeRecoveryCode(trx, userId, remaining);
  });
}

export async function setupMfa(userId: string, email: string, meta: RequestMeta) {
  const secret = generateMfaSecret();
  const { plain, hashed } = generateRecoveryCodes();

  await db.transaction().execute(async (trx) => {
    const { dekId, dek } = await createDek(trx, 'system');
    try {
      await repo.upsertMfaSecret(trx, {
        userId,
        secretEnc: encryptField(secret, dek),
        dekId,
        recoveryCodesHashed: hashed,
      });
    } finally {
      zeroize(dek);
    }
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: userId,
      actorEmail: email,
      action: 'MFA_SETUP_STARTED',
      entityType: 'user',
      entityId: userId,
      ipAddress: meta.ipAddress,
    });
  });

  // recoveryCodes chỉ trả về đúng một lần này, sau đó chỉ còn bản hash trong DB.
  return { otpauthUrl: buildOtpAuthUrl(email, secret), recoveryCodes: plain };
}

export async function confirmMfa(userId: string, email: string, code: string, meta: RequestMeta) {
  const record = await repo.findMfaSecret(userId);
  if (!record) throw new ConflictError('Chưa khởi tạo MFA — hãy gọi /auth/mfa/setup trước');
  if (record.confirmed_at) throw new ConflictError('MFA đã được kích hoạt');

  const dek = await loadDek(db, record.dek_id);
  let secret: string;
  try {
    secret = decryptField(record.secret_enc, dek);
  } finally {
    zeroize(dek);
  }

  const step = verifyTotpStep(secret, code);
  const claimed = step !== null && (await repo.claimTotpStep(db, userId, step));
  if (!claimed) {
    throw new UnauthorizedError('Mã xác thực không đúng');
  }

  await db.transaction().execute(async (trx) => {
    await repo.confirmMfa(trx, userId);
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: userId,
      actorEmail: email,
      action: 'MFA_ENABLED',
      entityType: 'user',
      entityId: userId,
      ipAddress: meta.ipAddress,
    });
  });
}

/** Bước 1 của luồng đăng ký MFA cho tài khoản chưa có MFA (dùng enrollment token). */
export async function startEnrollment(enrollmentToken: string, meta: RequestMeta) {
  const userId = readEnrollmentToken(enrollmentToken);
  const user = await repo.findUserById(userId);
  if (!user) throw new UnauthorizedError();
  if (user.mfa_enabled) throw new ConflictError('Tài khoản đã bật MFA');

  return setupMfa(userId, user.email, meta);
}

/** Bước 2: xác nhận mã TOTP, bật MFA và đăng nhập luôn. */
export async function confirmEnrollment(
  enrollmentToken: string,
  code: string,
  meta: RequestMeta,
): Promise<AuthSuccess> {
  const userId = readEnrollmentToken(enrollmentToken);
  const user = await db
    .selectFrom('users')
    .select(['id', 'email', 'role_id', 'mfa_enabled'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();

  if (user.mfa_enabled) throw new ConflictError('Tài khoản đã bật MFA');

  await confirmMfa(userId, user.email, code, meta);
  return issueSession(user.id, user.role_id, meta, 'LOGIN_SUCCESS_AFTER_ENROLLMENT');
}

export async function refresh(refreshToken: string, _meta: RequestMeta): Promise<AuthSuccess> {
  const session = await repo.findSessionByRefreshHash(hashToken(refreshToken));

  if (!session || session.revoked_at || session.expires_at.getTime() < Date.now()) {
    throw new UnauthorizedError('Phiên đăng nhập không hợp lệ');
  }

  const idleMs = Date.now() - session.last_activity_at.getTime();
  if (idleMs > env.SESSION_IDLE_TIMEOUT_SECONDS * 1000) {
    await db.transaction().execute((trx) => repo.revokeSession(trx, session.id, 'idle_timeout'));
    throw new UnauthorizedError('Phiên đăng nhập hết hạn do không hoạt động');
  }

  const user = await db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select(['users.id', 'users.email', 'users.full_name', 'users.role_id', 'users.status', 'roles.name as role_name'])
    .where('users.id', '=', session.user_id)
    .executeTakeFirstOrThrow();

  if (user.status !== 'active') {
    await db.transaction().execute((trx) => repo.revokeSession(trx, session.id, 'user_inactive'));
    throw new ForbiddenError('Tài khoản đã bị vô hiệu hoá');
  }

  // Xoay refresh token mỗi lần dùng — token cũ lập tức vô hiệu.
  const newRefresh = generateSecureToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);
  await db.transaction().execute((trx) =>
    repo.rotateRefreshToken(trx, session.id, hashToken(newRefresh), expiresAt),
  );

  const permissions = await repo.loadPermissions(user.role_id);
  const currentUser: CurrentUser = {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role_name,
    permissions,
  };

  return {
    kind: 'authenticated',
    accessToken: signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role_name,
      permissions,
      sessionId: session.id,
    }),
    refreshToken: newRefresh,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    user: currentUser,
  };
}

export async function logout(sessionId: string, actor: { id: string; email: string }, meta: RequestMeta) {
  await db.transaction().execute(async (trx) => {
    await repo.revokeSession(trx, sessionId, 'user_logout');
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'LOGOUT',
      ipAddress: meta.ipAddress,
    });
  });
}

export async function getCurrentUser(userId: string): Promise<CurrentUser> {
  const user = await db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select(['users.id', 'users.email', 'users.full_name', 'users.role_id', 'roles.name as role_name'])
    .where('users.id', '=', userId)
    .executeTakeFirst();

  if (!user) throw new UnauthorizedError();

  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role_name,
    permissions: await repo.loadPermissions(user.role_id),
  };
}

// ── nội bộ ────────────────────────────────────────────────────────────

function readMfaToken(token: string): string {
  try {
    return verifyMfaChallengeToken(token);
  } catch {
    throw new UnauthorizedError('Phiên xác thực hai bước đã hết hạn, vui lòng đăng nhập lại');
  }
}

function readEnrollmentToken(token: string): string {
  try {
    return verifyEnrollmentToken(token);
  } catch {
    throw new UnauthorizedError('Phiên đăng ký MFA đã hết hạn, vui lòng đăng nhập lại');
  }
}

async function auditFor(
  user: { id: string; email: string },
  action: string,
  outcome: 'success' | 'failure' | 'denied',
  reason: string | undefined,
  meta: RequestMeta,
) {
  await db.transaction().execute((trx) =>
    writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: user.id,
      actorEmail: user.email,
      action,
      outcome,
      reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    }),
  );
}

async function issueSession(
  userId: string,
  roleId: string,
  meta: RequestMeta,
  action: string,
  extra?: (trx: Parameters<Parameters<ReturnType<typeof db.transaction>['execute']>[0]>[0]) => Promise<void>,
): Promise<AuthSuccess> {
  const refreshToken = generateSecureToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);
  const permissions = await repo.loadPermissions(roleId);

  const { sessionId, user } = await db.transaction().execute(async (trx) => {
    const session = await repo.createSession(trx, {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await repo.resetFailedLogins(trx, userId);
    if (extra) await extra(trx);

    const u = await trx
      .selectFrom('users')
      .innerJoin('roles', 'roles.id', 'users.role_id')
      .select(['users.id', 'users.email', 'users.full_name', 'roles.name as role_name'])
      .where('users.id', '=', userId)
      .executeTakeFirstOrThrow();

    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: userId,
      actorEmail: u.email,
      action,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { sessionId: session.id, user: u };
  });

  const currentUser: CurrentUser = {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role_name,
    permissions,
  };

  return {
    kind: 'authenticated',
    accessToken: signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role_name,
      permissions,
      sessionId,
    }),
    refreshToken,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    user: currentUser,
  };
}
