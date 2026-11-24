import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import { generateDek, wrapDek, unwrapDek } from './field-encryption.js';
import { DataDestroyedError } from '../middleware/errors.js';

type Db = Kysely<Database> | Transaction<Database>;

export type DekType = 'patient' | 'document' | 'system';

/**
 * Sinh DEK mới, wrap bằng KEK rồi lưu bản đã wrap vào `encryption_keys`.
 * DEK plaintext chỉ tồn tại trong RAM và được trả về cho caller dùng ngay.
 */
export async function createDek(db: Db, keyType: DekType): Promise<{ dekId: string; dek: Buffer }> {
  const dek = generateDek();
  const { wrapped, kekReference } = await wrapDek(dek);

  const row = await db
    .insertInto('encryption_keys')
    .values({ key_type: keyType, wrapped_dek: wrapped, kek_reference: kekReference })
    .returning('id')
    .executeTakeFirstOrThrow();

  return { dekId: row.id, dek };
}

export async function loadDek(db: Db, dekId: string): Promise<Buffer> {
  const row = await db
    .selectFrom('encryption_keys')
    .select(['wrapped_dek', 'status'])
    .where('id', '=', dekId)
    .executeTakeFirst();

  if (!row) throw new Error(`Không tìm thấy khoá mã hoá ${dekId}`);
  if (row.status === 'destroyed') {
    throw new DataDestroyedError();
  }

  return unwrapDek(row.wrapped_dek);
}

/**
 * Tải nhiều DEK trong một lượt: một câu SELECT (WHERE id IN (...)) thay vì
 * N câu riêng lẻ, rồi unwrap SONG SONG thay vì tuần tự.
 *
 * Bắt buộc dùng ở mọi endpoint danh sách (list) — gọi `loadDek` tuần tự trong
 * vòng lặp từng dòng, ở dev với KEK cục bộ thì rẻ, nhưng production dùng AWS
 * KMS thì MỖI LẦN unwrap là một lệnh gọi mạng. Một trang 20 bệnh nhân gọi tuần
 * tự nghĩa là 20 round-trip KMS nối đuôi nhau (~20-50ms/lần) cộng dồn thành
 * hàng trăm mili-giây, cùng chi phí gọi API × 20 mỗi lần tải trang. Song song
 * hoá đưa thời gian đó về gần bằng một lần gọi.
 */
export async function loadDeks(db: Db, dekIds: readonly string[]): Promise<Map<string, Buffer>> {
  const uniqueIds = [...new Set(dekIds)];
  if (uniqueIds.length === 0) return new Map();

  const rows = await db
    .selectFrom('encryption_keys')
    .select(['id', 'wrapped_dek', 'status'])
    .where('id', 'in', uniqueIds)
    .execute();

  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = uniqueIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`Không tìm thấy khoá mã hoá: ${missing.join(', ')}`);
  }

  const entries = await Promise.all(
    uniqueIds.map(async (id) => {
      const row = byId.get(id)!;
      if (row.status === 'destroyed') {
        throw new DataDestroyedError();
      }
      return [id, await unwrapDek(row.wrapped_dek)] as const;
    }),
  );

  return new Map(entries);
}

/**
 * Crypto-shredding: ghi đè bản DEK đã wrap bằng zero và đánh dấu destroyed.
 * Sau bước này mọi ciphertext dùng khoá đó vĩnh viễn không giải mã được,
 * kể cả trong các bản backup cũ — đáp ứng "secure deletion" §164.310(d)(2)(i).
 */
export async function destroyDek(db: Db, dekId: string): Promise<void> {
  await db
    .updateTable('encryption_keys')
    .set({
      wrapped_dek: Buffer.alloc(32),
      status: 'destroyed',
      destroyed_at: new Date(),
    })
    .where('id', '=', dekId)
    .execute();
}
