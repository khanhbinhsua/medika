import type { Transaction } from 'kysely';
import { db } from '../../db/index.js';
import type { Database, PrescriptionStatus } from '../../db/types.js';
import { writeAuditLog, writePhiAccessLog } from '../../audit/audit-logger.js';
import { NotFoundError } from '../../middleware/errors.js';
import { loadDek } from '../../crypto/dek-store.js';
import { encryptOptionalField, decryptOptionalField, zeroize } from '../../crypto/field-encryption.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import type { CreatePrescriptionInput, ListPrescriptionsQuery } from './record.schemas.js';

type Db = typeof db | Transaction<Database>;

export interface PrescriptionDto {
  id: string;
  patientId: string;
  prescriberId: string;
  prescriberName: string;
  medication: string;
  rxnormCode: string | null;
  dosage: string;
  frequency: string;
  durationDays: number | null;
  quantity: string | null;
  instructions: string | null;
  status: PrescriptionStatus;
  prescribedAt: Date;
  expiresAt: Date | null;
}

// ── Đơn thuốc ─────────────────────────────────────────────────────────
// Trong CRM, đơn thuốc chủ yếu phục vụ nhắc tái khám / theo dõi tuân thủ dùng
// thuốc — một điểm chạm chăm sóc khách hàng, không phải tài liệu lâm sàng đầy đủ.

export async function createPrescription(
  input: CreatePrescriptionInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<PrescriptionDto> {
  return db.transaction().execute(async (trx) => {
    const patient = await requirePatient(trx, input.patientId);
    const dek = await loadDek(trx, patient.dek_id);

    try {
      const expiresAt = input.durationDays
        ? new Date(Date.now() + input.durationDays * 86_400_000)
        : null;

      const row = await trx
        .insertInto('prescriptions')
        .values({
          patient_id: input.patientId,
          prescriber_id: actor.id,
          medication: input.medication,
          rxnorm_code: input.rxnormCode ?? null,
          dosage: input.dosage,
          frequency: input.frequency,
          duration_days: input.durationDays ?? null,
          quantity: input.quantity ?? null,
          instructions_enc: encryptOptionalField(input.instructions, dek),
          expires_at: expiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'PRESCRIPTION_CREATE',
        entityType: 'prescription',
        entityId: row.id,
        ipAddress: meta.ipAddress,
      });

      await writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId: input.patientId,
        accessedBy: actor.id,
        accessType: 'create',
        fieldsAccessed: ['prescription'],
        ipAddress: meta.ipAddress,
      });

      return toPrescriptionDto(row, dek, actor.email);
    } finally {
      zeroize(dek);
    }
  });
}

export async function listPrescriptions(
  query: ListPrescriptionsQuery,
  actor: Actor,
  meta: RequestMeta,
): Promise<PrescriptionDto[]> {
  const patient = await requirePatient(db, query.patientId);

  let base = db
    .selectFrom('prescriptions')
    .innerJoin('users as prescriber', 'prescriber.id', 'prescriptions.prescriber_id')
    .where('prescriptions.patient_id', '=', query.patientId);

  if (query.status) base = base.where('prescriptions.status', '=', query.status);

  const rows = await base
    .selectAll('prescriptions')
    .select('prescriber.full_name as prescriber_name')
    .orderBy('prescriptions.prescribed_at', 'desc')
    .execute();

  const dek = await loadDek(db, patient.dek_id);
  let data: PrescriptionDto[];
  try {
    data = rows.map((r) => toPrescriptionDto(r, dek, r.prescriber_name));
  } finally {
    zeroize(dek);
  }

  if (data.length > 0) {
    await db.transaction().execute((trx) =>
      writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId: query.patientId,
        accessedBy: actor.id,
        accessType: 'view',
        fieldsAccessed: ['prescription'],
        ipAddress: meta.ipAddress,
      }),
    );
  }

  return data;
}

// ── nội bộ ────────────────────────────────────────────────────────────

async function requirePatient(trx: Db, patientId: string) {
  const patient = await trx
    .selectFrom('patients')
    .select(['id', 'dek_id'])
    .where('id', '=', patientId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (!patient) throw new NotFoundError('Bệnh nhân');
  return patient;
}

interface PrescriptionRow {
  id: string;
  patient_id: string;
  prescriber_id: string;
  medication: string;
  rxnorm_code: string | null;
  dosage: string;
  frequency: string;
  duration_days: number | null;
  quantity: string | null;
  instructions_enc: Buffer | null;
  status: PrescriptionStatus;
  prescribed_at: Date;
  expires_at: Date | null;
}

function toPrescriptionDto(row: PrescriptionRow, dek: Buffer, prescriberName: string): PrescriptionDto {
  return {
    id: row.id,
    patientId: row.patient_id,
    prescriberId: row.prescriber_id,
    prescriberName,
    medication: row.medication,
    rxnormCode: row.rxnorm_code,
    dosage: row.dosage,
    frequency: row.frequency,
    durationDays: row.duration_days,
    quantity: row.quantity,
    instructions: decryptOptionalField(row.instructions_enc, dek),
    status: row.status,
    prescribedAt: row.prescribed_at,
    expiresAt: row.expires_at,
  };
}
