import { db } from '../../db/index.js';
import type { ConsentType } from '../../db/types.js';
import { writeAuditLog } from '../../audit/audit-logger.js';
import { NotFoundError, ConflictError } from '../../middleware/errors.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';

export interface ConsentDto {
  id: string;
  patientId: string;
  consentType: ConsentType;
  granted: boolean;
  documentVersion: string;
  grantedAt: Date;
  revokedAt: Date | null;
  witnessedByName: string | null;
  notes: string | null;
}

export const CONSENT_TYPES: ConsentType[] = [
  'treatment',
  'privacy_notice',
  'data_sharing',
  'research',
  'marketing',
];

export async function listConsents(patientId: string): Promise<ConsentDto[]> {
  await requirePatient(patientId);

  const rows = await db
    .selectFrom('patient_consents')
    .leftJoin('users', 'users.id', 'patient_consents.witnessed_by')
    .selectAll('patient_consents')
    .select('users.full_name as witnessed_by_name')
    .where('patient_consents.patient_id', '=', patientId)
    .orderBy('patient_consents.granted_at', 'desc')
    .execute();

  return rows.map(toDto);
}

/**
 * Ghi nhận một quyết định đồng ý. Bản ghi cũ cùng loại (nếu còn hiệu lực) được
 * thu hồi trước — chỉ số duy nhất `patient_consents_active_idx` ở DB cho phép
 * tối đa một bản còn hiệu lực cho mỗi (bệnh nhân, loại đồng ý).
 *
 * Bản ghi cũ KHÔNG bị xoá: lịch sử đồng ý là chứng cứ pháp lý, phải giữ nguyên
 * để chứng minh tại thời điểm điều trị đã có sự đồng ý hợp lệ.
 */
export async function recordConsent(
  input: {
    patientId: string;
    consentType: ConsentType;
    granted: boolean;
    documentVersion: string;
    notes?: string | undefined;
  },
  actor: Actor,
  meta: RequestMeta,
): Promise<ConsentDto> {
  await requirePatient(input.patientId);

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable('patient_consents')
      .set({ revoked_at: new Date() })
      .where('patient_id', '=', input.patientId)
      .where('consent_type', '=', input.consentType)
      .where('revoked_at', 'is', null)
      .execute();

    const row = await trx
      .insertInto('patient_consents')
      .values({
        patient_id: input.patientId,
        consent_type: input.consentType,
        granted: input.granted,
        document_version: input.documentVersion,
        witnessed_by: actor.id,
        notes: input.notes ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: input.granted ? 'CONSENT_GRANTED' : 'CONSENT_DENIED',
      entityType: 'patient_consent',
      entityId: row.id,
      changes: {
        consentType: { old: null, new: input.consentType },
        granted: { old: null, new: input.granted },
      },
      ipAddress: meta.ipAddress,
    });

    return toDto({ ...row, witnessed_by_name: null });
  });
}

export async function revokeConsent(
  consentId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('patient_consents')
      .select(['id', 'patient_id', 'consent_type', 'revoked_at'])
      .where('id', '=', consentId)
      .forUpdate()
      .executeTakeFirst();

    if (!current) throw new NotFoundError('Bản ghi đồng ý');
    if (current.revoked_at) throw new ConflictError('Bản ghi đồng ý này đã được thu hồi');

    await trx
      .updateTable('patient_consents')
      .set({ revoked_at: new Date() })
      .where('id', '=', consentId)
      .execute();

    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'CONSENT_REVOKED',
      entityType: 'patient_consent',
      entityId: consentId,
      changes: { consentType: { old: current.consent_type, new: null } },
      ipAddress: meta.ipAddress,
    });
  });
}

/**
 * Kiểm tra bệnh nhân có đang đồng ý một loại nào đó không.
 * Dùng cho các luồng cần kiểm tra trước khi hành động (ví dụ gửi email nhắc lịch
 * cần `privacy_notice`, chia sẻ dữ liệu ra ngoài cần `data_sharing`).
 */
export async function hasActiveConsent(patientId: string, consentType: ConsentType): Promise<boolean> {
  const row = await db
    .selectFrom('patient_consents')
    .select('granted')
    .where('patient_id', '=', patientId)
    .where('consent_type', '=', consentType)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();

  return row?.granted === true;
}

// ── nội bộ ────────────────────────────────────────────────────────────

async function requirePatient(patientId: string) {
  const patient = await db
    .selectFrom('patients')
    .select('id')
    .where('id', '=', patientId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (!patient) throw new NotFoundError('Bệnh nhân');
  return patient;
}

interface ConsentRow {
  id: string;
  patient_id: string;
  consent_type: ConsentType;
  granted: boolean;
  document_version: string;
  granted_at: Date;
  revoked_at: Date | null;
  notes: string | null;
  witnessed_by_name: string | null;
}

function toDto(row: ConsentRow): ConsentDto {
  return {
    id: row.id,
    patientId: row.patient_id,
    consentType: row.consent_type,
    granted: row.granted,
    documentVersion: row.document_version,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    witnessedByName: row.witnessed_by_name,
    notes: row.notes,
  };
}
