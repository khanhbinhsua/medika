import { db } from '../../db/index.js';
import type { SeverityLevel } from '../../db/types.js';
import { writeAuditLog, writePhiAccessLog } from '../../audit/audit-logger.js';
import { NotFoundError } from '../../middleware/errors.js';
import { loadDek } from '../../crypto/dek-store.js';
import { encryptOptionalField, decryptOptionalField, zeroize } from '../../crypto/field-encryption.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import type { CreateConditionInput, UpdateConditionInput, CreateAllergyInput } from './conditions.schemas.js';

export interface ConditionDto {
  id: string;
  condition: string;
  icd10Code: string | null;
  status: string;
  onsetDate: string | null;
  notes: string | null;
  createdAt: string;
}

export interface AllergyDto {
  id: string;
  allergyName: string;
  reaction: string | null;
  severity: SeverityLevel;
  notes: string | null;
  recordedAt: string;
}

async function requirePatient(patientId: string): Promise<{ dekId: string }> {
  const row = await db
    .selectFrom('patients')
    .select(['dek_id'])
    .where('id', '=', patientId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('Bệnh nhân');
  return { dekId: row.dek_id };
}

const dateStr = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Bệnh lý + dị ứng của bệnh nhân — dùng để cá nhân hoá chăm sóc & phân nhóm. */
export async function getForPatient(
  patientId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<{ conditions: ConditionDto[]; allergies: AllergyDto[] }> {
  const { dekId } = await requirePatient(patientId);

  const [condRows, allergyRows] = await Promise.all([
    db
      .selectFrom('patient_medical_history')
      .selectAll()
      .where('patient_id', '=', patientId)
      .orderBy('created_at', 'desc')
      .execute(),
    db
      .selectFrom('patient_allergies')
      .selectAll()
      .where('patient_id', '=', patientId)
      .orderBy('recorded_at', 'desc')
      .execute(),
  ]);

  const dek = await loadDek(db, dekId);
  try {
    const conditions: ConditionDto[] = condRows.map((r) => ({
      id: r.id,
      condition: r.condition,
      icd10Code: r.icd10_code,
      status: r.status,
      onsetDate: dateStr(r.onset_date),
      notes: decryptOptionalField(r.notes_enc, dek),
      createdAt: new Date(r.created_at).toISOString(),
    }));
    const allergies: AllergyDto[] = allergyRows.map((r) => ({
      id: r.id,
      allergyName: r.allergy_name,
      reaction: r.reaction,
      severity: r.severity,
      notes: decryptOptionalField(r.notes_enc, dek),
      recordedAt: new Date(r.recorded_at).toISOString(),
    }));

    if (conditions.length + allergies.length > 0) {
      await db.transaction().execute((trx) =>
        writePhiAccessLog(trx, {
          requestId: meta.requestId,
          patientId,
          accessedBy: actor.id,
          accessType: 'view',
          fieldsAccessed: ['condition', 'allergy'],
          ipAddress: meta.ipAddress,
        }),
      );
    }
    return { conditions, allergies };
  } finally {
    zeroize(dek);
  }
}

export async function addCondition(
  patientId: string,
  input: CreateConditionInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<ConditionDto> {
  const { dekId } = await requirePatient(patientId);
  const dek = await loadDek(db, dekId);
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('patient_medical_history')
        .values({
          patient_id: patientId,
          condition: input.condition,
          icd10_code: input.icd10Code ?? null,
          status: input.status,
          onset_date: input.onsetDate ? new Date(input.onsetDate) : null,
          notes_enc: encryptOptionalField(input.notes, dek),
          recorded_by: actor.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'CONDITION_ADD',
        entityType: 'patient_medical_history',
        entityId: row.id,
        ipAddress: meta.ipAddress,
      });
      await writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId,
        accessedBy: actor.id,
        accessType: 'create',
        fieldsAccessed: ['condition'],
        ipAddress: meta.ipAddress,
      });
      return {
        id: row.id,
        condition: row.condition,
        icd10Code: row.icd10_code,
        status: row.status,
        onsetDate: dateStr(row.onset_date),
        notes: decryptOptionalField(row.notes_enc, dek),
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  } finally {
    zeroize(dek);
  }
}

export async function updateCondition(
  id: string,
  input: UpdateConditionInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<ConditionDto> {
  const existing = await db
    .selectFrom('patient_medical_history')
    .select(['id', 'patient_id'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!existing) throw new NotFoundError('Bệnh lý');

  const { dekId } = await requirePatient(existing.patient_id);
  const dek = await loadDek(db, dekId);
  try {
    return await db.transaction().execute(async (trx) => {
      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (input.condition !== undefined) patch.condition = input.condition;
      if (input.icd10Code !== undefined) patch.icd10_code = input.icd10Code;
      if (input.status !== undefined) patch.status = input.status;
      if (input.onsetDate !== undefined) patch.onset_date = input.onsetDate ? new Date(input.onsetDate) : null;
      if (input.notes !== undefined) patch.notes_enc = encryptOptionalField(input.notes, dek);

      const row = await trx
        .updateTable('patient_medical_history')
        .set(patch)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'CONDITION_UPDATE',
        entityType: 'patient_medical_history',
        entityId: id,
        ipAddress: meta.ipAddress,
      });
      return {
        id: row.id,
        condition: row.condition,
        icd10Code: row.icd10_code,
        status: row.status,
        onsetDate: dateStr(row.onset_date),
        notes: decryptOptionalField(row.notes_enc, dek),
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  } finally {
    zeroize(dek);
  }
}

export async function deleteCondition(id: string, actor: Actor, meta: RequestMeta): Promise<void> {
  const existing = await db
    .selectFrom('patient_medical_history')
    .select(['id'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!existing) throw new NotFoundError('Bệnh lý');
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('patient_medical_history').where('id', '=', id).execute();
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'CONDITION_DELETE',
      entityType: 'patient_medical_history',
      entityId: id,
      ipAddress: meta.ipAddress,
    });
  });
}

export async function addAllergy(
  patientId: string,
  input: CreateAllergyInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<AllergyDto> {
  const { dekId } = await requirePatient(patientId);
  const dek = await loadDek(db, dekId);
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('patient_allergies')
        .values({
          patient_id: patientId,
          allergy_name: input.allergyName,
          reaction: input.reaction ?? null,
          severity: input.severity,
          notes_enc: encryptOptionalField(input.notes, dek),
          recorded_by: actor.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'ALLERGY_ADD',
        entityType: 'patient_allergies',
        entityId: row.id,
        ipAddress: meta.ipAddress,
      });
      await writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId,
        accessedBy: actor.id,
        accessType: 'create',
        fieldsAccessed: ['allergy'],
        ipAddress: meta.ipAddress,
      });
      return {
        id: row.id,
        allergyName: row.allergy_name,
        reaction: row.reaction,
        severity: row.severity,
        notes: decryptOptionalField(row.notes_enc, dek),
        recordedAt: new Date(row.recorded_at).toISOString(),
      };
    });
  } finally {
    zeroize(dek);
  }
}

export async function deleteAllergy(id: string, actor: Actor, meta: RequestMeta): Promise<void> {
  const existing = await db
    .selectFrom('patient_allergies')
    .select(['id'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!existing) throw new NotFoundError('Dị ứng');
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('patient_allergies').where('id', '=', id).execute();
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'ALLERGY_DELETE',
      entityType: 'patient_allergies',
      entityId: id,
      ipAddress: meta.ipAddress,
    });
  });
}
