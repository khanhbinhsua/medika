import type { Transaction } from 'kysely';
import { db } from '../../db/index.js';
import type { Database } from '../../db/types.js';
import { writeAuditLog, writePhiAccessLog } from '../../audit/audit-logger.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../../middleware/errors.js';
import { loadDek } from '../../crypto/dek-store.js';
import { encryptField, encryptOptionalField, decryptOptionalField, zeroize } from '../../crypto/field-encryption.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import type { CreateEncounterInput, UpdateEncounterInput, AmendEncounterInput } from './encounters.schemas.js';

export interface EncounterDto {
  id: string; patientId: string; doctorId: string; appointmentId: string | null; status: string;
  reason: string | null; history: string | null; pastPersonal: string | null; pastFamily: string | null;
  vitals: Record<string, unknown>;
  examGeneral: string | null; examOrgans: string | null; labsSummary: string | null;
  treatment: string | null; dxNote: string | null;
  dxPrimaryIcd10: string | null; dxSecondaryIcd10: string[];
  treatmentFrom: string | null; treatmentTo: string | null;
  signedAt: string | null; locked: boolean; createdAt: string; updatedAt: string;
}
export interface EncounterSummary {
  id: string; status: string; dxPrimaryIcd10: string | null; dxName: string | null;
  doctorName: string; createdAt: string;
}

const dstr = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

async function requireDek(patientId: string): Promise<string> {
  const row = await db.selectFrom('patients').select('dek_id').where('id', '=', patientId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!row) throw new NotFoundError('Bệnh nhân');
  return row.dek_id;
}

function toDto(r: Record<string, any>, dek: Buffer): EncounterDto {
  const d = (b: Buffer | null) => decryptOptionalField(b, dek);
  return {
    id: r.id, patientId: r.patient_id, doctorId: r.doctor_id, appointmentId: r.appointment_id, status: r.status,
    reason: d(r.reason_enc), history: d(r.history_enc), pastPersonal: d(r.past_personal_enc), pastFamily: d(r.past_family_enc),
    vitals: r.vitals ?? {},
    examGeneral: d(r.exam_general_enc), examOrgans: d(r.exam_organs_enc), labsSummary: d(r.labs_summary_enc),
    treatment: d(r.treatment_enc), dxNote: d(r.dx_note_enc),
    dxPrimaryIcd10: r.dx_primary_icd10, dxSecondaryIcd10: r.dx_secondary_icd10 ?? [],
    treatmentFrom: dstr(r.treatment_from), treatmentTo: dstr(r.treatment_to),
    signedAt: r.signed_at ? new Date(r.signed_at).toISOString() : null, locked: r.locked,
    createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  };
}

// Dựng patch cột từ input (mã hoá các trường lâm sàng).
function buildPatch(input: UpdateEncounterInput, dek: Buffer): Record<string, unknown> {
  const p: Record<string, unknown> = { updated_at: new Date() };
  const enc = (v: string | undefined) => (v === undefined ? undefined : encryptOptionalField(v, dek));
  if (input.reason !== undefined) p.reason_enc = enc(input.reason);
  if (input.history !== undefined) p.history_enc = enc(input.history);
  if (input.pastPersonal !== undefined) p.past_personal_enc = enc(input.pastPersonal);
  if (input.pastFamily !== undefined) p.past_family_enc = enc(input.pastFamily);
  if (input.vitals !== undefined) p.vitals = JSON.stringify(input.vitals);
  if (input.examGeneral !== undefined) p.exam_general_enc = enc(input.examGeneral);
  if (input.examOrgans !== undefined) p.exam_organs_enc = enc(input.examOrgans);
  if (input.labsSummary !== undefined) p.labs_summary_enc = enc(input.labsSummary);
  if (input.treatment !== undefined) p.treatment_enc = enc(input.treatment);
  if (input.dxNote !== undefined) p.dx_note_enc = enc(input.dxNote);
  if (input.dxPrimaryIcd10 !== undefined) p.dx_primary_icd10 = input.dxPrimaryIcd10;
  if (input.dxSecondaryIcd10 !== undefined) p.dx_secondary_icd10 = input.dxSecondaryIcd10;
  if (input.treatmentFrom !== undefined) p.treatment_from = input.treatmentFrom ? new Date(input.treatmentFrom) : null;
  if (input.treatmentTo !== undefined) p.treatment_to = input.treatmentTo ? new Date(input.treatmentTo) : null;
  return p;
}

export async function createEncounter(input: CreateEncounterInput, actor: Actor, meta: RequestMeta): Promise<EncounterDto> {
  const dekId = await requireDek(input.patientId);
  const branch = await db.selectFrom('branches').select('id').where('is_default', '=', true).executeTakeFirst();
  const dek = await loadDek(db, dekId);
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx.insertInto('encounters').values({
        patient_id: input.patientId, appointment_id: input.appointmentId ?? null,
        doctor_id: actor.id, branch_id: branch?.id ?? null,
      }).returningAll().executeTakeFirstOrThrow();
      await writeAuditLog(trx, { requestId: meta.requestId, actorId: actor.id, actorEmail: actor.email, action: 'ENCOUNTER_CREATE', entityType: 'encounter', entityId: row.id, ipAddress: meta.ipAddress });
      await writePhiAccessLog(trx, { requestId: meta.requestId, patientId: input.patientId, accessedBy: actor.id, accessType: 'create', fieldsAccessed: ['encounter'], ipAddress: meta.ipAddress });
      return toDto(row, dek);
    });
  } finally { zeroize(dek); }
}

export async function getEncounter(id: string, actor: Actor, meta: RequestMeta): Promise<EncounterDto> {
  const row = await db.selectFrom('encounters').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw new NotFoundError('Bệnh án');
  const dek = await loadDek(db, await requireDek(row.patient_id));
  try {
    const dto = toDto(row, dek);
    await db.transaction().execute((trx) => writePhiAccessLog(trx, { requestId: meta.requestId, patientId: row.patient_id, accessedBy: actor.id, accessType: 'view', fieldsAccessed: ['encounter'], ipAddress: meta.ipAddress }));
    return dto;
  } finally { zeroize(dek); }
}

export async function updateEncounter(id: string, input: UpdateEncounterInput, actor: Actor, meta: RequestMeta): Promise<EncounterDto> {
  const cur = await db.selectFrom('encounters').select(['patient_id', 'locked']).where('id', '=', id).executeTakeFirst();
  if (!cur) throw new NotFoundError('Bệnh án');
  if (cur.locked) throw new ConflictError('Bệnh án đã ký — hãy dùng sửa bổ sung (amend)');
  const dek = await loadDek(db, await requireDek(cur.patient_id));
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx.updateTable('encounters').set(buildPatch(input, dek)).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await writeAuditLog(trx, { requestId: meta.requestId, actorId: actor.id, actorEmail: actor.email, action: 'ENCOUNTER_UPDATE', entityType: 'encounter', entityId: id, ipAddress: meta.ipAddress });
      await writePhiAccessLog(trx, { requestId: meta.requestId, patientId: cur.patient_id, accessedBy: actor.id, accessType: 'modify', fieldsAccessed: Object.keys(input), ipAddress: meta.ipAddress });
      return toDto(row, dek);
    });
  } finally { zeroize(dek); }
}

/** Hoàn tất = ký điện tử + khoá. Chỉ bác sĩ lập bệnh án mới được ký. */
export async function signEncounter(id: string, actor: Actor, meta: RequestMeta): Promise<EncounterDto> {
  const dek = await loadDek(db, await requireDek((await encRow(id)).patient_id));
  try {
    return await db.transaction().execute(async (trx) => {
      const cur = await trx.selectFrom('encounters').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!cur) throw new NotFoundError('Bệnh án');
      if (cur.locked) throw new ConflictError('Bệnh án đã được ký');
      if (cur.doctor_id !== actor.id) throw new ForbiddenError('Chỉ bác sĩ lập bệnh án mới được ký');
      const row = await trx.updateTable('encounters').set({ status: 'signed', locked: true, signed_at: new Date(), signed_by: actor.id, updated_at: new Date() }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await writeAuditLog(trx, { requestId: meta.requestId, actorId: actor.id, actorEmail: actor.email, action: 'ENCOUNTER_SIGN', entityType: 'encounter', entityId: id, ipAddress: meta.ipAddress });
      return toDto(row, dek);
    });
  } finally { zeroize(dek); }
}

/** Sửa bổ sung sau khi ký — snapshot bản cũ, áp giá trị mới, trạng thái 'amended'. */
export async function amendEncounter(id: string, input: AmendEncounterInput, actor: Actor, meta: RequestMeta): Promise<EncounterDto> {
  const base = await encRow(id);
  const dek = await loadDek(db, await requireDek(base.patient_id));
  try {
    return await db.transaction().execute(async (trx) => {
      const cur = await trx.selectFrom('encounters').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!cur) throw new NotFoundError('Bệnh án');
      if (!cur.locked) throw new ConflictError('Bệnh án chưa ký — sửa trực tiếp (update)');
      // Snapshot bản hiện tại (đã giải mã) → mã hoá lưu vào versions.
      const snapshot = JSON.stringify(toDto(cur, dek));
      const lastV = await trx.selectFrom('encounter_versions').select((eb) => eb.fn.max('version').as('m')).where('encounter_id', '=', id).executeTakeFirst();
      await trx.insertInto('encounter_versions').values({
        encounter_id: id, version: Number(lastV?.m ?? 0) + 1, snapshot_enc: encryptField(snapshot, dek),
        changed_by: actor.id, change_reason: input.changeReason,
      }).execute();
      const { changeReason, ...fields } = input;
      void changeReason;
      const patch = buildPatch(fields, dek);
      patch.status = 'amended';
      const row = await trx.updateTable('encounters').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await writeAuditLog(trx, { requestId: meta.requestId, actorId: actor.id, actorEmail: actor.email, action: 'ENCOUNTER_AMEND', entityType: 'encounter', entityId: id, reason: input.changeReason, ipAddress: meta.ipAddress });
      await writePhiAccessLog(trx, { requestId: meta.requestId, patientId: cur.patient_id, accessedBy: actor.id, accessType: 'modify', fieldsAccessed: Object.keys(fields), ipAddress: meta.ipAddress });
      return toDto(row, dek);
    });
  } finally { zeroize(dek); }
}

export async function listByPatient(patientId: string): Promise<EncounterSummary[]> {
  const rows = await db
    .selectFrom('encounters as e')
    .innerJoin('users as d', 'd.id', 'e.doctor_id')
    .leftJoin('icd10_codes as c', 'c.code', 'e.dx_primary_icd10')
    .select(['e.id', 'e.status', 'e.dx_primary_icd10', 'c.name as dxName', 'd.full_name as doctorName', 'e.created_at'])
    .where('e.patient_id', '=', patientId)
    .orderBy('e.created_at', 'desc')
    .execute();
  return rows.map((r) => ({ id: r.id, status: r.status, dxPrimaryIcd10: r.dx_primary_icd10, dxName: r.dxName, doctorName: r.doctorName, createdAt: new Date(r.created_at).toISOString() }));
}

export async function listVersions(id: string, actor: Actor, meta: RequestMeta): Promise<{ version: number; changeReason: string; changedBy: string; createdAt: string; snapshot: EncounterDto }[]> {
  const base = await encRow(id);
  const rows = await db.selectFrom('encounter_versions').selectAll().where('encounter_id', '=', id).orderBy('version', 'desc').execute();
  if (rows.length === 0) return [];
  const dek = await loadDek(db, await requireDek(base.patient_id));
  try {
    const out = rows.map((r) => ({ version: r.version, changeReason: r.change_reason, changedBy: r.changed_by, createdAt: new Date(r.created_at).toISOString(), snapshot: JSON.parse(decryptOptionalField(r.snapshot_enc, dek) ?? '{}') as EncounterDto }));
    await db.transaction().execute((trx) => writePhiAccessLog(trx, { requestId: meta.requestId, patientId: base.patient_id, accessedBy: actor.id, accessType: 'view', fieldsAccessed: ['encounter_history'], ipAddress: meta.ipAddress }));
    return out;
  } finally { zeroize(dek); }
}

async function encRow(id: string) {
  const r = await db.selectFrom('encounters').select(['patient_id']).where('id', '=', id).executeTakeFirst();
  if (!r) throw new NotFoundError('Bệnh án');
  return r;
}

export type Db = typeof db | Transaction<Database>;
