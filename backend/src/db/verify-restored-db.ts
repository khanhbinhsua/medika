import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './types.js';
import { verifyChainRows, type VerifiableRow } from '../audit/audit-logger.js';

/**
 * Xác minh một database KHÔNG PHẢI database chính (dùng sau khi phục hồi từ
 * bản sao lưu) — cố tình KHÔNG dùng singleton `db` ở db/index.ts (nó luôn trỏ
 * cố định vào DATABASE_URL), mà tự tạo kết nối riêng tới DB đích truyền vào.
 */
async function main() {
  const targetDb = process.argv[2];
  if (!targetDb) {
    console.error('Cách dùng: tsx src/db/verify-restored-db.ts <ten_database>');
    process.exit(1);
  }

  const base = new URL(process.env.DATABASE_URL ?? 'postgresql://crm_app:changeme@localhost:5433/crm_dk');
  base.pathname = `/${targetDb}`;

  pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v));
  const pool = new pg.Pool({ connectionString: base.toString() });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  try {
    const tables = [
      'patients',
      'appointments',
      'prescriptions',
      'patient_consents',
      'audit_logs',
      'phi_access_logs',
      'users',
    ] as const;

    const counts: Record<string, number> = {};
    for (const table of tables) {
      const { count } = await db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow();
      counts[table] = Number(count);
    }

    const auditRows = await db.selectFrom('audit_logs').selectAll().orderBy('id', 'asc').execute();
    const chain = verifyChainRows(auditRows as unknown as VerifiableRow[]);

    console.log(JSON.stringify({ rowCounts: counts, auditChain: chain }, null, 2));

    const ok = chain.valid && Object.values(counts).some((c) => c > 0);
    process.exit(ok ? 0 : 1);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
