import { sql } from 'kysely';
import { db, closeDatabase } from '../db/index.js';
import { logger } from '../config/logger.js';

/**
 * Tạo trước partition theo THÁNG cho audit_logs và phi_access_logs. Hai bảng
 * này RANGE-partition theo thời gian với một DEFAULT partition — dữ liệu mới
 * vẫn ghi được vào default, nhưng khi bảng lớn dần (giữ 6 năm theo HIPAA) thì
 * partition theo tháng giúp truy vấn/lưu trữ/xoá nhanh hơn nhiều.
 *
 * Chạy hàng tháng (cron/EventBridge). Idempotent: bỏ qua partition đã tồn tại.
 * Mặc định tạo cho tháng SAU (chuẩn bị trước), truyền YYYY-MM để tạo tháng cụ thể.
 */
function monthRange(base: Date): { start: string; end: string; suffix: string } {
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));
  const suffix = `${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), suffix };
}

async function ensurePartition(parent: string, range: { start: string; end: string; suffix: string }): Promise<boolean> {
  const name = `${parent}_${range.suffix}`;
  const exists = await sql<{ exists: boolean }>`
    SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = ${name}) AS exists
  `.execute(db);
  if (exists.rows[0]?.exists) return false;

  // DDL không nhận bind param cho FOR VALUES — phải inline literal. An toàn vì
  // mọi giá trị sinh từ Date trong code (tên bảng cố định, range là YYYY-MM-DD),
  // không có input người dùng. Vẫn kiểm định dạng phòng hờ.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)) {
    throw new Error(`Khoảng ngày không hợp lệ: ${range.start}..${range.end}`);
  }
  await sql.raw(
    `CREATE TABLE ${name} PARTITION OF ${parent} FOR VALUES FROM ('${range.start}') TO ('${range.end}')`,
  ).execute(db);
  return true;
}

async function main() {
  const arg = process.argv[2]; // YYYY-MM tuỳ chọn
  const base = arg ? new Date(`${arg}-01T00:00:00Z`) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
  if (Number.isNaN(base.getTime())) {
    logger.error({ arg }, 'Tham số tháng không hợp lệ (cần YYYY-MM)');
    process.exit(1);
  }

  const range = monthRange(base);
  const results: Record<string, boolean> = {};
  for (const parent of ['audit_logs', 'phi_access_logs']) {
    results[parent] = await ensurePartition(parent, range);
  }

  logger.info({ month: range.suffix, created: results }, 'Kiểm tra/tạo partition audit hoàn tất');
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, 'Tạo partition audit thất bại');
    await closeDatabase();
    process.exit(1);
  });
