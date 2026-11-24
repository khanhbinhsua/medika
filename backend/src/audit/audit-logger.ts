import { createHash } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { Database, AuditOutcome } from '../db/types.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export const GENESIS_HASH = '0'.repeat(64);

/** Id cố định cho advisory lock của chuỗi audit. */
const AUDIT_CHAIN_LOCK_ID = 0x4155_4449;

export interface AuditEntry {
  requestId?: string | undefined;
  actorId?: string | undefined;
  actorEmail?: string | undefined;
  action: string;
  entityType?: string | undefined;
  entityId?: string | undefined;
  changes?: Record<string, { old: unknown; new: unknown }> | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  outcome?: AuditOutcome | undefined;
  reason?: string | undefined;
}

type Db = Kysely<Database> | Transaction<Database>;

/**
 * Chuỗi hash: entry_hash = SHA256(prev_hash || canonical_json(entry)).
 * Sửa hoặc xoá một dòng làm đứt chuỗi ở mọi dòng sau nó → verifyAuditChain() phát hiện.
 */
interface HashableEntry {
  prevHash: string;
  requestId: string | null;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  changes: unknown;
  outcome: string;
  createdAt: string;
}

/**
 * Sắp xếp khoá đệ quy để chuỗi JSON không phụ thuộc thứ tự chèn.
 *
 * Bắt buộc với cột `changes`: PostgreSQL lưu nó dưới dạng jsonb, mà jsonb
 * CHUẨN HOÁ LẠI thứ tự khoá (ngắn trước, rồi so byte). Ghi {firstName, lastName}
 * nhưng đọc ra {lastName, firstName}. Nếu băm theo thứ tự chèn thì hash lúc ghi
 * và lúc kiểm tra sẽ khác nhau, khiến MỌI dòng có `changes` bị báo giả mạo nhầm.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    sorted[key] = sortKeysDeep(source[key]);
  }
  return sorted;
}

/** Chuỗi ký tự chuẩn hoá được băm. Thứ tự khoá cố định để hash tái lập được. */
function canonicalize(e: HashableEntry): string {
  return JSON.stringify({
    prevHash: e.prevHash,
    requestId: e.requestId,
    actorId: e.actorId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    changes: sortKeysDeep(e.changes ?? null),
    outcome: e.outcome,
    createdAt: e.createdAt,
  });
}

function computeEntryHash(prevHash: string, entry: AuditEntry, createdAt: string): string {
  return createHash('sha256')
    .update(
      canonicalize({
        prevHash,
        requestId: entry.requestId ?? null,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        changes: entry.changes ?? null,
        outcome: entry.outcome ?? 'success',
        createdAt,
      }),
    )
    .digest('hex');
}

/**
 * Ghi audit log. PHẢI được gọi trong cùng transaction với thao tác nghiệp vụ —
 * nếu nghiệp vụ rollback thì audit cũng rollback, giữ nhất quán.
 *
 * Khoá tư vấn (advisory lock) đảm bảo chuỗi hash không bị đan xen khi ghi đồng thời.
 */
export async function writeAuditLog(trx: Db, entry: AuditEntry): Promise<void> {
  // Serialize việc ghi để chuỗi hash không bị đan xen giữa các transaction đồng thời.
  await sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_ID})`.execute(trx);

  const last = await trx
    .selectFrom('audit_logs')
    .select(['entry_hash'])
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();

  const prevHash = last?.entry_hash ?? GENESIS_HASH;
  const createdAt = new Date();
  const entryHash = computeEntryHash(prevHash, entry, createdAt.toISOString());

  await trx
    .insertInto('audit_logs')
    .values({
      request_id: entry.requestId ?? null,
      actor_id: entry.actorId ?? null,
      actor_email: entry.actorEmail ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      changes: entry.changes ? JSON.stringify(entry.changes) : null,
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
      outcome: entry.outcome ?? 'success',
      reason: entry.reason ?? null,
      prev_hash: prevHash,
      entry_hash: entryHash,
      created_at: createdAt,
    })
    .execute();
}

export interface PhiAccessEntry {
  requestId?: string | undefined;
  patientId: string;
  accessedBy: string;
  accessType: 'view' | 'create' | 'modify' | 'export' | 'print';
  fieldsAccessed: string[];
  purpose?: string | undefined;
  ipAddress?: string | undefined;
}

export async function writePhiAccessLog(trx: Db, entry: PhiAccessEntry): Promise<void> {
  await writePhiAccessLogs(trx, [entry]);
}

/**
 * Ghi nhiều dòng nhật ký truy cập PHI trong MỘT câu INSERT nhiều hàng, thay
 * vì N câu INSERT tuần tự trong vòng lặp — dùng ở các endpoint danh sách, nơi
 * một lần tải trang chạm tới nhiều bệnh nhân cùng lúc.
 */
export async function writePhiAccessLogs(trx: Db, entries: readonly PhiAccessEntry[]): Promise<void> {
  if (entries.length === 0) return;

  await trx
    .insertInto('phi_access_logs')
    .values(
      entries.map((entry) => ({
        request_id: entry.requestId ?? null,
        patient_id: entry.patientId,
        accessed_by: entry.accessedBy,
        access_type: entry.accessType,
        fields_accessed: entry.fieldsAccessed,
        purpose: entry.purpose ?? 'treatment',
        ip_address: entry.ipAddress ?? null,
      })),
    )
    .execute();
}

export type TamperKind = 'broken_link' | 'content_modified';

export interface ChainVerification {
  valid: boolean;
  entriesChecked: number;
  brokenAtId?: string;
  kind?: TamperKind;
  detail?: string;
  /** Mốc bắt đầu kiểm tra và số dòng nằm trước mốc đó (không được kiểm tra). */
  baselineId?: string;
  entriesBeforeBaseline?: number;
}

/** Hình dạng tối thiểu của một dòng audit cần cho việc kiểm tra. */
export interface VerifiableRow {
  id: string | number | bigint;
  request_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  changes: unknown;
  outcome: string;
  prev_hash: string;
  entry_hash: string;
  created_at: Date;
}

/**
 * Phần lõi thuần tuý của phép kiểm tra — không chạm database nên unit test được
 * với dữ liệu tổng hợp, không cần tắt trigger bảo vệ hay sửa nhật ký thật.
 */
export function verifyChainRows(rows: readonly VerifiableRow[]): ChainVerification {
  let expectedPrev: string | null = null;
  let checked = 0;

  for (const row of rows) {
    if (expectedPrev !== null && row.prev_hash !== expectedPrev) {
      return {
        valid: false,
        entriesChecked: checked,
        brokenAtId: String(row.id),
        kind: 'broken_link',
        detail: 'prev_hash không khớp entry_hash của dòng liền trước — có dòng bị xoá hoặc chèn thêm',
      };
    }

    const recomputed = createHash('sha256')
      .update(
        canonicalize({
          prevHash: row.prev_hash,
          requestId: row.request_id,
          actorId: row.actor_id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          changes: row.changes ?? null,
          outcome: row.outcome,
          createdAt: row.created_at.toISOString(),
        }),
      )
      .digest('hex');

    if (recomputed !== row.entry_hash) {
      return {
        valid: false,
        entriesChecked: checked,
        brokenAtId: String(row.id),
        kind: 'content_modified',
        detail: 'entry_hash không khớp nội dung dòng — dữ liệu đã bị sửa sau khi ghi',
      };
    }

    expectedPrev = row.entry_hash;
    checked += 1;
  }

  return { valid: true, entriesChecked: checked };
}

/**
 * Kiểm tra toàn vẹn nhật ký kiểm toán — HIPAA §164.312(c)(1).
 *
 * Hai phép kiểm tra khác nhau, cần cả hai:
 *   1. Mắt xích: prev_hash của dòng sau phải bằng entry_hash của dòng trước.
 *      Bắt được hành vi XOÁ hoặc CHÈN dòng.
 *   2. Nội dung: tính lại entry_hash từ chính nội dung dòng đó.
 *      Bắt được hành vi SỬA nội dung — ví dụ đổi action từ PATIENT_DELETE
 *      thành PATIENT_VIEW trong khi giữ nguyên cả hai cột hash. Chỉ kiểm tra
 *      mắt xích thì kiểu giả mạo này lọt hoàn toàn.
 *
 * Trigger ở DB đã chặn UPDATE/DELETE từ tài khoản ứng dụng, nhưng superuser,
 * quyền truy cập DB trực tiếp hay bản backup bị sửa thì không bị trigger chặn.
 * Đó chính là lúc chuỗi hash phải lên tiếng.
 */
export async function verifyAuditChain(fromId?: string): Promise<ChainVerification> {
  const baseline = fromId ?? String(env.AUDIT_CHAIN_BASELINE_ID);

  const [rows, before] = await Promise.all([
    db.selectFrom('audit_logs').selectAll().where('id', '>', baseline).orderBy('id', 'asc').execute(),
    db
      .selectFrom('audit_logs')
      .select((eb) => eb.fn.countAll<string>().as('c'))
      .where('id', '<=', baseline)
      .executeTakeFirstOrThrow(),
  ]);

  const result = verifyChainRows(rows as unknown as VerifiableRow[]);
  const entriesBeforeBaseline = Number(before.c);

  if (!result.valid) {
    logger.error(
      { auditLogId: result.brokenAtId, kind: result.kind },
      'Phát hiện nhật ký kiểm toán bị giả mạo',
    );
  }

  return { ...result, baselineId: baseline, entriesBeforeBaseline };
}

/** Dùng trong test để dựng chuỗi hợp lệ mà không cần database. */
export function hashForRow(row: Omit<VerifiableRow, 'entry_hash' | 'id'>): string {
  return createHash('sha256')
    .update(
      canonicalize({
        prevHash: row.prev_hash,
        requestId: row.request_id,
        actorId: row.actor_id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        changes: row.changes ?? null,
        outcome: row.outcome,
        createdAt: row.created_at.toISOString(),
      }),
    )
    .digest('hex');
}
