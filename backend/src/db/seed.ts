import { db, closeDatabase } from './index.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { initCrypto } from '../crypto/field-encryption.js';
import { hashPassword } from '../modules/auth/password.service.js';
import { writeAuditLog } from '../audit/audit-logger.js';

/**
 * Tạo tài khoản dev cho từng vai trò. CHỈ dùng ở development.
 * Mật khẩu in ra console để tiện thử, tuyệt đối không dùng ở staging/prod.
 */
const DEV_USERS = [
  { email: 'admin@crm-dk.local', fullName: 'Quản Trị Viên', role: 'admin' },
  { email: 'bacsi@crm-dk.local', fullName: 'BS. Nguyễn Văn An', role: 'doctor' },
  { email: 'yta@crm-dk.local', fullName: 'YT. Trần Thị Bình', role: 'nurse' },
  { email: 'letan@crm-dk.local', fullName: 'Lê Thị Cúc', role: 'receptionist' },
  { email: 'kiemtoan@crm-dk.local', fullName: 'Phạm Văn Dũng', role: 'auditor' },
];

const DEV_PASSWORD = 'DevPassword123!';

async function main() {
  if (env.NODE_ENV === 'production') {
    throw new Error('Seed script không được chạy ở production');
  }

  await initCrypto();
  const passwordHash = await hashPassword(DEV_PASSWORD);

  for (const u of DEV_USERS) {
    const role = await db
      .selectFrom('roles')
      .select('id')
      .where('name', '=', u.role)
      .executeTakeFirstOrThrow();

    const existing = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', u.email)
      .executeTakeFirst();

    if (existing) {
      logger.info({ email: u.email }, 'Bỏ qua, tài khoản đã tồn tại');
      continue;
    }

    await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('users')
        .values({
          email: u.email,
          password_hash: passwordHash,
          full_name: u.fullName,
          role_id: role.id,
          // MFA chưa bật: đăng nhập lần đầu phải chạy /auth/mfa/setup.
          mfa_enabled: false,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await writeAuditLog(trx, {
        action: 'USER_SEEDED',
        entityType: 'user',
        entityId: created.id,
        actorEmail: 'system:seed',
        reason: 'development seed script',
      });
    });

    logger.info({ email: u.email, role: u.role }, 'Đã tạo tài khoản');
  }

  logger.info(`Mật khẩu dev cho tất cả tài khoản trên: ${DEV_PASSWORD}`);
  logger.warn('MFA_REQUIRED=true nghĩa là phải chạy /auth/mfa/setup trước khi đăng nhập được đầy đủ');
}

main()
  .then(() => closeDatabase())
  .catch(async (err) => {
    logger.error({ err }, 'Seed thất bại');
    await closeDatabase();
    process.exit(1);
  });
