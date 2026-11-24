import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { verifyAuditChain } from '../../audit/audit-logger.js';
import { loadDeks } from '../../crypto/dek-store.js';
import { decryptOptionalField, zeroize } from '../../crypto/field-encryption.js';

export interface ListAuditQuery {
  page: number;
  pageSize: number;
  action?: string | undefined;
  actorId?: string | undefined;
  outcome?: 'success' | 'failure' | 'denied' | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export async function listAuditLogs(query: ListAuditQuery) {
  let base = db.selectFrom('audit_logs');

  if (query.action) base = base.where('action', '=', query.action);
  if (query.actorId) base = base.where('actor_id', '=', query.actorId);
  if (query.outcome) base = base.where('outcome', '=', query.outcome);
  if (query.from) base = base.where('created_at', '>=', new Date(query.from));
  if (query.to) base = base.where('created_at', '<=', new Date(query.to));

  const { count } = await base
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();

  const rows = await base
    .select([
      'id',
      'request_id',
      'actor_email',
      'action',
      'entity_type',
      'entity_id',
      'changes',
      'ip_address',
      'outcome',
      'reason',
      'created_at',
    ])
    .orderBy('id', 'desc')
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .execute();

  const total = Number(count);
  return {
    data: rows.map((r) => ({
      id: String(r.id),
      requestId: r.request_id,
      actorEmail: r.actor_email,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      changes: r.changes,
      ipAddress: r.ip_address,
      outcome: r.outcome,
      reason: r.reason,
      createdAt: r.created_at,
    })),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

/**
 * "Accounting of disclosures" (§164.528): bệnh nhân có quyền yêu cầu biết ai
 * đã xem hồ sơ của mình. Tên bệnh nhân được giải mã để báo cáo đọc được.
 */
export async function listPhiAccess(query: {
  page: number;
  pageSize: number;
  patientId?: string | undefined;
  accessedBy?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}) {
  let base = db
    .selectFrom('phi_access_logs')
    .innerJoin('users', 'users.id', 'phi_access_logs.accessed_by')
    .innerJoin('patients', 'patients.id', 'phi_access_logs.patient_id');

  if (query.patientId) base = base.where('phi_access_logs.patient_id', '=', query.patientId);
  if (query.accessedBy) base = base.where('phi_access_logs.accessed_by', '=', query.accessedBy);
  if (query.from) base = base.where('phi_access_logs.accessed_at', '>=', new Date(query.from));
  if (query.to) base = base.where('phi_access_logs.accessed_at', '<=', new Date(query.to));

  const { count } = await base
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();

  const rows = await base
    .select([
      'phi_access_logs.id',
      'phi_access_logs.patient_id',
      'phi_access_logs.access_type',
      'phi_access_logs.fields_accessed',
      'phi_access_logs.purpose',
      'phi_access_logs.ip_address',
      'phi_access_logs.accessed_at',
      'users.email as actor_email',
      'users.full_name as actor_name',
      'patients.mrn',
      'patients.first_name_enc',
      'patients.last_name_enc',
      'patients.dek_id',
    ])
    .orderBy('phi_access_logs.id', 'desc')
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .execute();

  const data = [];
  const deks = await loadDeks(db, rows.map((r) => r.dek_id));
  try {
    for (const r of rows) {
      const dek = deks.get(r.dek_id)!;
      data.push({
        id: String(r.id),
        patientId: r.patient_id,
        patientMrn: r.mrn,
        patientName: `${decryptOptionalField(r.first_name_enc, dek) ?? ''} ${
          decryptOptionalField(r.last_name_enc, dek) ?? ''
        }`.trim(),
        accessType: r.access_type,
        fieldsAccessed: r.fields_accessed,
        purpose: r.purpose,
        ipAddress: r.ip_address,
        actorEmail: r.actor_email,
        actorName: r.actor_name,
        accessedAt: r.accessed_at,
      });
    }
  } finally {
    for (const dek of deks.values()) zeroize(dek);
  }

  const total = Number(count);
  return {
    data,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

export async function verifyIntegrity() {
  return verifyAuditChain();
}

// ── Phát hiện bất thường ──────────────────────────────────────────────

export type AnomalySeverity = 'high' | 'medium' | 'low';

export interface Anomaly {
  kind: string;
  severity: AnomalySeverity;
  title: string;
  detail: string;
  actorEmail: string | null;
  count: number;
  occurredAt: Date;
}

/** Ngoài 07:00–19:00 coi là ngoài giờ hành chính. */
const WORK_START_HOUR = 7;
const WORK_END_HOUR = 19;

/**
 * Rà soát hoạt động hệ thống — HIPAA §164.308(a)(1)(ii)(D).
 * Đây là các dấu hiệu cảnh báo, KHÔNG phải kết luận vi phạm: mỗi mục cần người
 * phụ trách tuân thủ xem xét trong ngữ cảnh (trực cấp cứu ban đêm là hợp lệ).
 */
export async function detectAnomalies(windowHours: number): Promise<Anomaly[]> {
  const since = new Date(Date.now() - windowHours * 3600_000);
  const anomalies: Anomaly[] = [];

  // 1. Một tài khoản xem quá nhiều hồ sơ khác nhau — dấu hiệu dò/rút dữ liệu.
  const bulk = await db
    .selectFrom('phi_access_logs')
    .innerJoin('users', 'users.id', 'phi_access_logs.accessed_by')
    .select([
      'users.email as actor_email',
      (eb) => eb.fn.count<string>('phi_access_logs.patient_id').distinct().as('patients'),
      (eb) => eb.fn.max('phi_access_logs.accessed_at').as('last_at'),
    ])
    .where('phi_access_logs.accessed_at', '>=', since)
    .groupBy('users.email')
    .having((eb) => eb.fn.count('phi_access_logs.patient_id').distinct(), '>=', 20)
    .execute();

  for (const row of bulk) {
    anomalies.push({
      kind: 'bulk_phi_access',
      severity: 'high',
      title: 'Truy cập số lượng lớn hồ sơ',
      detail: `Đã xem ${row.patients} hồ sơ bệnh nhân khác nhau trong ${windowHours} giờ qua`,
      actorEmail: row.actor_email,
      count: Number(row.patients),
      occurredAt: row.last_at as Date,
    });
  }

  // 2. Truy cập PHI ngoài giờ hành chính.
  const afterHours = await db
    .selectFrom('phi_access_logs')
    .innerJoin('users', 'users.id', 'phi_access_logs.accessed_by')
    .select([
      'users.email as actor_email',
      (eb) => eb.fn.countAll<string>().as('hits'),
      (eb) => eb.fn.max('phi_access_logs.accessed_at').as('last_at'),
    ])
    .where('phi_access_logs.accessed_at', '>=', since)
    .where(
      sql<boolean>`extract(hour from phi_access_logs.accessed_at) < ${WORK_START_HOUR}
                   OR extract(hour from phi_access_logs.accessed_at) >= ${WORK_END_HOUR}`,
    )
    .groupBy('users.email')
    .execute();

  for (const row of afterHours) {
    anomalies.push({
      kind: 'after_hours_access',
      severity: 'low',
      title: 'Truy cập ngoài giờ hành chính',
      detail: `${row.hits} lượt truy cập PHI ngoài khung ${WORK_START_HOUR}:00–${WORK_END_HOUR}:00`,
      actorEmail: row.actor_email,
      count: Number(row.hits),
      occurredAt: row.last_at as Date,
    });
  }

  // 3. Bị từ chối quyền nhiều lần — dấu hiệu dò quyền hoặc tài khoản bị chiếm.
  const denied = await db
    .selectFrom('audit_logs')
    .select([
      'actor_email',
      (eb) => eb.fn.countAll<string>().as('hits'),
      (eb) => eb.fn.max('created_at').as('last_at'),
    ])
    .where('created_at', '>=', since)
    .where('outcome', '=', 'denied')
    .groupBy('actor_email')
    .having((eb) => eb.fn.countAll(), '>=', 5)
    .execute();

  for (const row of denied) {
    anomalies.push({
      kind: 'repeated_denials',
      severity: 'medium',
      title: 'Nhiều lần bị từ chối quyền',
      detail: `${row.hits} lượt truy cập bị chặn — có thể đang dò quyền hoặc tài khoản bị chiếm`,
      actorEmail: row.actor_email,
      count: Number(row.hits),
      occurredAt: row.last_at as Date,
    });
  }

  // 4. Đăng nhập thất bại dồn dập — dấu hiệu thử mật khẩu hàng loạt.
  const failedLogins = await db
    .selectFrom('audit_logs')
    .select([
      'actor_email',
      (eb) => eb.fn.countAll<string>().as('hits'),
      (eb) => eb.fn.max('created_at').as('last_at'),
    ])
    .where('created_at', '>=', since)
    .where('action', 'in', ['LOGIN_FAILED', 'MFA_FAILED'])
    .groupBy('actor_email')
    .having((eb) => eb.fn.countAll(), '>=', 5)
    .execute();

  for (const row of failedLogins) {
    anomalies.push({
      kind: 'failed_login_burst',
      severity: 'high',
      title: 'Đăng nhập thất bại liên tiếp',
      detail: `${row.hits} lần đăng nhập/xác thực thất bại`,
      actorEmail: row.actor_email,
      count: Number(row.hits),
      occurredAt: row.last_at as Date,
    });
  }

  // 5. Bác sĩ xem hồ sơ bệnh nhân mà mình không có lịch hẹn nào — dấu hiệu
  //    tò mò cá nhân (xem hồ sơ người quen, người nổi tiếng). Đây là dạng vi
  //    phạm HIPAA phổ biến nhất trong thực tế.
  const unrelated = await sql<{
    actor_email: string;
    patients: string;
    last_at: Date;
  }>`
    SELECT u.email AS actor_email,
           count(DISTINCT p.patient_id)::text AS patients,
           max(p.accessed_at) AS last_at
    FROM phi_access_logs p
    JOIN users u  ON u.id = p.accessed_by
    JOIN roles r  ON r.id = u.role_id
    WHERE p.accessed_at >= ${since}
      AND r.name = 'doctor'
      AND NOT EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.patient_id = p.patient_id
          AND a.doctor_id  = p.accessed_by
      )
    GROUP BY u.email
  `.execute(db);

  for (const row of unrelated.rows) {
    anomalies.push({
      kind: 'unrelated_patient_access',
      severity: 'high',
      title: 'Xem hồ sơ không thuộc phạm vi điều trị',
      detail: `Đã xem ${row.patients} hồ sơ của bệnh nhân mà tài khoản này không có lịch hẹn hay hồ sơ điều trị nào`,
      actorEmail: row.actor_email,
      count: Number(row.patients),
      occurredAt: row.last_at,
    });
  }

  const order: Record<AnomalySeverity, number> = { high: 0, medium: 1, low: 2 };
  return anomalies.sort(
    (a, b) => order[a.severity] - order[b.severity] || b.occurredAt.getTime() - a.occurredAt.getTime(),
  );
}

/** Số liệu tóm tắt cho bảng điều khiển tuân thủ. */
export async function complianceSummary() {
  const [users, patients, mfaAdoption, last24h, deniedToday] = await Promise.all([
    db.selectFrom('users').select((eb) => eb.fn.countAll<string>().as('c')).where('status', '=', 'active').executeTakeFirstOrThrow(),
    db.selectFrom('patients').select((eb) => eb.fn.countAll<string>().as('c')).where('deleted_at', 'is', null).executeTakeFirstOrThrow(),
    db.selectFrom('users').select((eb) => eb.fn.countAll<string>().as('c')).where('mfa_enabled', '=', true).where('status', '=', 'active').executeTakeFirstOrThrow(),
    db.selectFrom('phi_access_logs').select((eb) => eb.fn.countAll<string>().as('c')).where('accessed_at', '>=', new Date(Date.now() - 86_400_000)).executeTakeFirstOrThrow(),
    db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<string>().as('c')).where('outcome', '=', 'denied').where('created_at', '>=', new Date(Date.now() - 86_400_000)).executeTakeFirstOrThrow(),
  ]);

  const activeUsers = Number(users.c);
  const withMfa = Number(mfaAdoption.c);

  return {
    activeUsers,
    activePatients: Number(patients.c),
    mfaEnabled: withMfa,
    mfaCoveragePercent: activeUsers === 0 ? 0 : Math.round((withMfa / activeUsers) * 100),
    phiAccessLast24h: Number(last24h.c),
    deniedLast24h: Number(deniedToday.c),
  };
}
