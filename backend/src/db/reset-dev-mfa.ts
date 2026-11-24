import { db, closeDatabase } from './index.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Gỡ MFA của các tài khoản dev để smoke test chạy lại được từ đầu.
 * CHỈ dành cho development — không bao giờ chạy ở staging/production.
 */
async function main() {
  if (env.NODE_ENV !== 'development') {
    throw new Error(`reset-dev-mfa chỉ chạy ở development (hiện tại: ${env.NODE_ENV})`);
  }

  const devUsers = await db
    .selectFrom('users')
    .select(['id', 'email'])
    .where('email', 'like', '%@crm-dk.local')
    .execute();

  if (devUsers.length === 0) {
    logger.warn('Không tìm thấy tài khoản dev nào — chạy `npm run seed` trước');
    return;
  }

  const ids = devUsers.map((u) => u.id);

  await db.deleteFrom('mfa_secrets').where('user_id', 'in', ids).execute();
  await db
    .updateTable('users')
    .set({ mfa_enabled: false, failed_login_attempts: 0, locked_until: null })
    .where('id', 'in', ids)
    .execute();
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date(), revoked_reason: 'dev_reset' })
    .where('user_id', 'in', ids)
    .where('revoked_at', 'is', null)
    .execute();

  logger.info({ count: devUsers.length }, 'Đã gỡ MFA và thu hồi session của tài khoản dev');
}

main()
  .then(() => closeDatabase())
  .catch(async (err) => {
    logger.error({ err }, 'Reset thất bại');
    await closeDatabase();
    process.exit(1);
  });
