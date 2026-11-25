import type { Transaction } from 'kysely';
import { db } from '../../db/index.js';
import type { Database } from '../../db/types.js';
import { writeAuditLog, writePhiAccessLog } from '../../audit/audit-logger.js';
import { NotFoundError } from '../../middleware/errors.js';
import { loadDek } from '../../crypto/dek-store.js';
import { encryptOptionalField, decryptOptionalField, zeroize } from '../../crypto/field-encryption.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import type { CreateComplaintInput, UpdateComplaintInput } from './complaints.schemas.js';

type Db = typeof db | Transaction<Database>;

export interface ComplaintListItem {
  id: string; code: string; patientId: string; category: string; severity: string;
  status: string; title: string; assignedToName: string | null;
  resolvedAt: string | null; createdAt: string;
}
export interface ComplaintDetail extends ComplaintListItem {
  detail: string | null;
  resolution: string | null;
}

interface Row {
  id: string; code: string; patient_id: string; category: string; severity: string;
  status: string; title: string; detail_enc: Buffer | null; resolution_enc: Buffer | null;
  assigned_to: string | null; assigned_to_name: string | null;
  resolved_at: Date | null; created_at: Date;
}

function toListItem(r: Row): ComplaintListItem {
  return {
    id: r.id, code: r.code, patientId: r.patient_id, category: r.category, severity: r.severity,
    status: r.status, title: r.title, assignedToName: r.assigned_to_name,
    resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}
function toDetail(r: Row, dek: Buffer): ComplaintDetail {
  return { ...toListItem(r), detail: decryptOptionalField(r.detail_enc, dek), resolution: decryptOptionalField(r.resolution_enc, dek) };
}

async function patientDekId(ex: Db, patientId: string): Promise<string> {
  const p = await ex
    .selectFrom('patients')
    .select('dek_id')
    .where('id', '=', patientId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!p) throw new NotFoundError('Bệnh nhân');
  return p.dek_id;
}

function selectRow(ex: Db, id: string) {
  return ex
    .selectFrom('complaints as c')
    .leftJoin('users as u', 'u.id', 'c.assigned_to')
    .selectAll('c')
    .select('u.full_name as assigned_to_name')
    .where('c.id', '=', id)
    .executeTakeFirst();
}

/** Danh sách khiếu nại của bệnh nhân — chỉ trường plaintext (không giải mã, không phi-log). */
export async function listByPatient(patientId: string): Promise<ComplaintListItem[]> {
  const rows = await db
    .selectFrom('complaints as c')
    .leftJoin('users as u', 'u.id', 'c.assigned_to')
    .select([
      'c.id', 'c.code', 'c.patient_id', 'c.category', 'c.severity', 'c.status', 'c.title',
      'u.full_name as assigned_to_name', 'c.resolved_at', 'c.created_at',
    ])
    .where('c.patient_id', '=', patientId)
    .orderBy('c.created_at', 'desc')
    .execute();
  return rows.map((r) => toListItem({ ...r, detail_enc: null, resolution_enc: null, assigned_to: null } as Row));
}

export async function getOne(id: string, actor: Actor, meta: RequestMeta): Promise<ComplaintDetail> {
  const r = (await selectRow(db, id)) as Row | undefined;
  if (!r) throw new NotFoundError('Khiếu nại');
  const dek = await loadDek(db, await patientDekId(db, r.patient_id));
  try {
    const dto = toDetail(r, dek);
    await db.transaction().execute((trx) =>
      writePhiAccessLog(trx, {
        requestId: meta.requestId, patientId: r.patient_id, accessedBy: actor.id,
        accessType: 'view', fieldsAccessed: ['complaint'], ipAddress: meta.ipAddress,
      }),
    );
    return dto;
  } finally {
    zeroize(dek);
  }
}

export async function create(
  patientId: string, input: CreateComplaintInput, actor: Actor, meta: RequestMeta,
): Promise<ComplaintDetail> {
  return db.transaction().execute(async (trx) => {
    const dek = await loadDek(trx, await patientDekId(trx, patientId));
    try {
      const ins = await trx
        .insertInto('complaints')
        .values({
          patient_id: patientId,
          category: input.category,
          severity: input.severity,
          title: input.title,
          detail_enc: encryptOptionalField(input.detail, dek),
          assigned_to: input.assignedTo ?? null,
          created_by: actor.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeAuditLog(trx, {
        requestId: meta.requestId, actorId: actor.id, actorEmail: actor.email,
        action: 'COMPLAINT_CREATE', entityType: 'complaint', entityId: ins.id, ipAddress: meta.ipAddress,
      });
      await writePhiAccessLog(trx, {
        requestId: meta.requestId, patientId, accessedBy: actor.id,
        accessType: 'create', fieldsAccessed: ['complaint'], ipAddress: meta.ipAddress,
      });
      const r = (await selectRow(trx, ins.id)) as Row;
      return toDetail(r, dek);
    } finally {
      zeroize(dek);
    }
  });
}

export async function update(
  id: string, input: UpdateComplaintInput, actor: Actor, meta: RequestMeta,
): Promise<ComplaintDetail> {
  return db.transaction().execute(async (trx) => {
    const cur = await trx
      .selectFrom('complaints')
      .select(['id', 'patient_id', 'status'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!cur) throw new NotFoundError('Khiếu nại');

    const dek = await loadDek(trx, await patientDekId(trx, cur.patient_id));
    try {
      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (input.status) {
        patch.status = input.status;
        patch.resolved_at = input.status === 'resolved' || input.status === 'closed' ? new Date() : null;
      }
      if (input.severity) patch.severity = input.severity;
      if (input.assignedTo !== undefined) patch.assigned_to = input.assignedTo;
      if (input.resolution !== undefined) {
        patch.resolution_enc = input.resolution === null ? null : encryptOptionalField(input.resolution, dek);
      }

      await trx.updateTable('complaints').set(patch).where('id', '=', id).execute();
      await writeAuditLog(trx, {
        requestId: meta.requestId, actorId: actor.id, actorEmail: actor.email,
        action: 'COMPLAINT_UPDATE', entityType: 'complaint', entityId: id,
        changes: input.status ? { status: { old: cur.status, new: input.status } } : undefined,
        ipAddress: meta.ipAddress,
      });
      const r = (await selectRow(trx, id)) as Row;
      return toDetail(r, dek);
    } finally {
      zeroize(dek);
    }
  });
}
