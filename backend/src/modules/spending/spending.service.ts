import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { writeAuditLog, writePhiAccessLog, writePhiAccessLogs } from '../../audit/audit-logger.js';
import { NotFoundError } from '../../middleware/errors.js';
import { loadDek, loadDeks } from '../../crypto/dek-store.js';
import { encryptOptionalField, decryptOptionalField, zeroize } from '../../crypto/field-encryption.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import type {
  CreateTransactionInput,
  UpdateTransactionInput,
  ListTransactionsQuery,
  TopSpendersQuery,
  ImportInput,
} from './spending.schemas.js';

// ── DTO ────────────────────────────────────────────────────────────────────
export interface TransactionDto {
  id: string;
  occurredAt: string;
  amount: number;
  category: string;
  note: string | null;
  source: string;
  createdAt: string;
}

export interface Tier {
  code: string;
  name: string;
  minTotal: number;
}

export interface SpendingSummary {
  total: number;
  count: number;
  firstAt: string | null;
  lastAt: string | null;
  tier: { code: string; name: string };
  byMonth: { month: string; total: number }[];
  byCategory: { category: string; total: number }[];
}

export interface TopSpender {
  patientId: string;
  mrn: string;
  name: string;
  total: number;
  count: number;
  lastAt: string | null;
  tier: { code: string; name: string };
}

// ── Hạng VIP ────────────────────────────────────────────────────────────────
export async function getTiers(): Promise<Tier[]> {
  const rows = await db.selectFrom('spending_tiers').selectAll().orderBy('sort', 'asc').execute();
  return rows.map((r) => ({ code: r.code, name: r.name, minTotal: Number(r.min_total) }));
}

/** Hạng cao nhất mà tổng chi tiêu ≥ min_total. `tiers` phải sắp tăng dần theo min. */
function pickTier(total: number, tiers: Tier[]): { code: string; name: string } {
  let chosen = tiers[0] ?? { code: 'thuong', name: 'Thường', minTotal: 0 };
  for (const t of tiers) if (total >= t.minTotal) chosen = t;
  return { code: chosen.code, name: chosen.name };
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

// ── Ghi khoản chi ────────────────────────────────────────────────────────────
export async function addTransaction(
  patientId: string,
  input: CreateTransactionInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<TransactionDto> {
  const { dekId } = await requirePatient(patientId);
  const dek = await loadDek(db, dekId);
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('patient_transactions')
        .values({
          patient_id: patientId,
          occurred_at: new Date(input.occurredAt),
          amount: input.amount,
          category: input.category,
          note_enc: encryptOptionalField(input.note, dek),
          source: 'manual',
          created_by: actor.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'SPENDING_ADD',
        entityType: 'patient_transaction',
        entityId: row.id,
        ipAddress: meta.ipAddress,
      });
      await writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId,
        accessedBy: actor.id,
        accessType: 'create',
        fieldsAccessed: ['transaction.amount', 'transaction.note'],
        ipAddress: meta.ipAddress,
      });
      return toDto(row, decryptOptionalField(row.note_enc, dek));
    });
  } finally {
    zeroize(dek);
  }
}

export async function updateTransaction(
  id: string,
  input: UpdateTransactionInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<TransactionDto> {
  const existing = await db
    .selectFrom('patient_transactions')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!existing) throw new NotFoundError('Khoản chi tiêu');

  const { dekId } = await requirePatient(existing.patient_id);
  const dek = await loadDek(db, dekId);
  try {
    return await db.transaction().execute(async (trx) => {
      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (input.occurredAt !== undefined) patch.occurred_at = new Date(input.occurredAt);
      if (input.amount !== undefined) patch.amount = input.amount;
      if (input.category !== undefined) patch.category = input.category;
      if (input.note !== undefined) patch.note_enc = encryptOptionalField(input.note, dek);

      const row = await trx
        .updateTable('patient_transactions')
        .set(patch)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'SPENDING_UPDATE',
        entityType: 'patient_transaction',
        entityId: id,
        ipAddress: meta.ipAddress,
      });
      await writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId: existing.patient_id,
        accessedBy: actor.id,
        accessType: 'modify',
        fieldsAccessed: Object.keys(input),
        ipAddress: meta.ipAddress,
      });
      return toDto(row, decryptOptionalField(row.note_enc, dek));
    });
  } finally {
    zeroize(dek);
  }
}

export async function deleteTransaction(id: string, actor: Actor, meta: RequestMeta): Promise<void> {
  const existing = await db
    .selectFrom('patient_transactions')
    .select(['id', 'patient_id'])
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!existing) throw new NotFoundError('Khoản chi tiêu');

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('patient_transactions')
      .set({ deleted_at: new Date() })
      .where('id', '=', id)
      .execute();
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'SPENDING_DELETE',
      entityType: 'patient_transaction',
      entityId: id,
      ipAddress: meta.ipAddress,
    });
  });
}

// ── Đọc theo bệnh nhân ────────────────────────────────────────────────────────
export async function listTransactions(
  patientId: string,
  q: ListTransactionsQuery,
  actor: Actor,
  meta: RequestMeta,
): Promise<TransactionDto[]> {
  const { dekId } = await requirePatient(patientId);

  let query = db
    .selectFrom('patient_transactions')
    .selectAll()
    .where('patient_id', '=', patientId)
    .where('deleted_at', 'is', null);
  if (q.from) query = query.where('occurred_at', '>=', new Date(q.from));
  if (q.to) query = query.where('occurred_at', '<=', new Date(q.to));
  const rows = await query.orderBy('occurred_at', 'desc').orderBy('created_at', 'desc').execute();

  const dek = await loadDek(db, dekId);
  try {
    const dtos = rows.map((r) => toDto(r, decryptOptionalField(r.note_enc, dek)));
    await db.transaction().execute((trx) =>
      writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId,
        accessedBy: actor.id,
        accessType: 'view',
        fieldsAccessed: ['transaction.amount', 'transaction.note'],
        ipAddress: meta.ipAddress,
      }),
    );
    return dtos;
  } finally {
    zeroize(dek);
  }
}

/** Tổng hợp chi tiêu 1 bệnh nhân (thuần số tiền — không giải mã PHI). */
export async function patientSummary(
  patientId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<SpendingSummary> {
  await requirePatient(patientId);
  const tiers = await getTiers();

  const totals = await sql<{ total: string | null; c: string; first_at: Date | null; last_at: Date | null }>`
    SELECT sum(amount)::text AS total, count(*)::text AS c,
           min(occurred_at) AS first_at, max(occurred_at) AS last_at
    FROM patient_transactions WHERE patient_id = ${patientId} AND deleted_at IS NULL
  `.execute(db);

  const byMonth = await sql<{ month: string; total: string }>`
    SELECT to_char(date_trunc('month', occurred_at), 'YYYY-MM') AS month, sum(amount)::text AS total
    FROM patient_transactions WHERE patient_id = ${patientId} AND deleted_at IS NULL
    GROUP BY 1 ORDER BY 1
  `.execute(db);

  const byCategory = await sql<{ category: string; total: string }>`
    SELECT category, sum(amount)::text AS total
    FROM patient_transactions WHERE patient_id = ${patientId} AND deleted_at IS NULL
    GROUP BY 1 ORDER BY sum(amount) DESC
  `.execute(db);

  const total = totals.rows[0]?.total ? Number(totals.rows[0].total) : 0;

  await db.transaction().execute((trx) =>
    writePhiAccessLog(trx, {
      requestId: meta.requestId,
      patientId,
      accessedBy: actor.id,
      accessType: 'view',
      fieldsAccessed: ['spending.summary'],
      ipAddress: meta.ipAddress,
    }),
  );

  return {
    total,
    count: Number(totals.rows[0]?.c ?? 0),
    firstAt: totals.rows[0]?.first_at ? new Date(totals.rows[0].first_at).toISOString() : null,
    lastAt: totals.rows[0]?.last_at ? new Date(totals.rows[0].last_at).toISOString() : null,
    tier: pickTier(total, tiers),
    byMonth: byMonth.rows.map((r) => ({ month: r.month, total: Number(r.total) })),
    byCategory: byCategory.rows.map((r) => ({ category: r.category, total: Number(r.total) })),
  };
}

// ── Khách chi nhiều nhất (CSKH) ──────────────────────────────────────────────
export async function topSpenders(q: TopSpendersQuery, actor: Actor, meta: RequestMeta): Promise<TopSpender[]> {
  const tiers = await getTiers();
  const minForTier = q.tier ? tiers.find((t) => t.code === q.tier)?.minTotal ?? 0 : 0;

  const from = q.from ? new Date(q.from) : null;
  const to = q.to ? new Date(q.to) : null;

  const agg = await sql<{ patient_id: string; total: string; c: string; last_at: Date }>`
    SELECT patient_id, sum(amount)::text AS total, count(*)::text AS c, max(occurred_at) AS last_at
    FROM patient_transactions
    WHERE deleted_at IS NULL
      ${from ? sql`AND occurred_at >= ${from}` : sql``}
      ${to ? sql`AND occurred_at <= ${to}` : sql``}
    GROUP BY patient_id
    HAVING sum(amount) >= ${minForTier}
    ORDER BY sum(amount) DESC
    LIMIT ${q.limit}
  `.execute(db);

  if (agg.rows.length === 0) return [];

  const patientIds = agg.rows.map((r) => r.patient_id);
  const patients = await db
    .selectFrom('patients')
    .select(['id', 'mrn', 'first_name_enc', 'last_name_enc', 'dek_id'])
    .where('id', 'in', patientIds)
    .where('deleted_at', 'is', null)
    .execute();
  const pById = new Map(patients.map((p) => [p.id, p]));
  const deks = await loadDeks(db, patients.map((p) => p.dek_id));

  const result: TopSpender[] = [];
  for (const r of agg.rows) {
    const p = pById.get(r.patient_id);
    if (!p) continue; // bệnh nhân đã xoá → bỏ qua
    const dek = deks.get(p.dek_id)!;
    const name = `${decryptOptionalField(p.first_name_enc, dek) ?? ''} ${
      decryptOptionalField(p.last_name_enc, dek) ?? ''
    }`.trim();
    const total = Number(r.total);
    result.push({
      patientId: p.id,
      mrn: p.mrn,
      name: name || p.mrn,
      total,
      count: Number(r.c),
      lastAt: r.last_at ? new Date(r.last_at).toISOString() : null,
      tier: pickTier(total, tiers),
    });
  }
  for (const dek of deks.values()) zeroize(dek);

  // Danh sách này lộ tên + chi tiêu của từng bệnh nhân → ghi phi_access cho mỗi người.
  await db.transaction().execute((trx) =>
    writePhiAccessLogs(
      trx,
      result.map((r) => ({
        requestId: meta.requestId,
        patientId: r.patientId,
        accessedBy: actor.id,
        accessType: 'view' as const,
        fieldsAccessed: ['firstName', 'lastName', 'spending.total'],
        purpose: 'top_spenders',
        ipAddress: meta.ipAddress,
      })),
    ),
  );
  return result;
}

// ── Nhập hàng loạt (CSV) ──────────────────────────────────────────────────────
export interface ImportResult {
  imported: number;
  skipped: { mrn: string; reason: string }[];
}

export async function importTransactions(input: ImportInput, actor: Actor, meta: RequestMeta): Promise<ImportResult> {
  // Khớp MRN → bệnh nhân (nạp DEK theo từng người để mã hoá ghi chú).
  const mrns = [...new Set(input.rows.map((r) => r.mrn))];
  const patients = await db
    .selectFrom('patients')
    .select(['id', 'mrn', 'dek_id'])
    .where('mrn', 'in', mrns)
    .where('deleted_at', 'is', null)
    .execute();
  const byMrn = new Map(patients.map((p) => [p.mrn, p]));
  const deks = await loadDeks(db, patients.map((p) => p.dek_id));

  const skipped: { mrn: string; reason: string }[] = [];
  const values: Array<{
    patient_id: string;
    occurred_at: Date;
    amount: number;
    category: string;
    note_enc: Buffer | null;
    source: string;
    created_by: string;
  }> = [];

  for (const row of input.rows) {
    const p = byMrn.get(row.mrn);
    if (!p) {
      skipped.push({ mrn: row.mrn, reason: 'không tìm thấy bệnh nhân' });
      continue;
    }
    const dek = deks.get(p.dek_id)!;
    values.push({
      patient_id: p.id,
      occurred_at: new Date(row.occurredAt),
      amount: row.amount,
      category: row.category ?? 'khac',
      note_enc: encryptOptionalField(row.note, dek),
      source: 'import',
      created_by: actor.id,
    });
  }

  try {
    if (values.length > 0) {
      await db.transaction().execute(async (trx) => {
        await trx.insertInto('patient_transactions').values(values).execute();
        await writeAuditLog(trx, {
          requestId: meta.requestId,
          actorId: actor.id,
          actorEmail: actor.email,
          action: 'SPENDING_IMPORT',
          entityType: 'patient_transaction',
          reason: `import ${values.length} dòng, bỏ qua ${skipped.length}`,
          ipAddress: meta.ipAddress,
        });
        await writePhiAccessLogs(
          trx,
          [...new Set(values.map((v) => v.patient_id))].map((patientId) => ({
            requestId: meta.requestId,
            patientId,
            accessedBy: actor.id,
            accessType: 'create' as const,
            fieldsAccessed: ['transaction.amount', 'transaction.note'],
            purpose: 'import',
            ipAddress: meta.ipAddress,
          })),
        );
      });
    }
  } finally {
    for (const dek of deks.values()) zeroize(dek);
  }

  return { imported: values.length, skipped };
}

// ── nội bộ ────────────────────────────────────────────────────────────────
interface TxnRow {
  id: string;
  occurred_at: Date;
  amount: string;
  category: string;
  source: string;
  created_at: Date;
}
function toDto(row: TxnRow, note: string | null): TransactionDto {
  return {
    id: row.id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    amount: Number(row.amount),
    category: row.category,
    note,
    source: row.source,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
