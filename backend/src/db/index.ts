import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { Database } from './types.js';

// pg trả bigint (int8) dưới dạng string mặc định — giữ nguyên để tránh mất độ chính xác.
// Nhưng timestamptz phải là Date, không phải string.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ...(env.DATABASE_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
});

pool.on('error', (err) => {
  logger.error({ err }, 'Lỗi client PostgreSQL nhàn rỗi');
});

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query('SELECT 1');
}

export async function closeDatabase(): Promise<void> {
  await db.destroy();
}
