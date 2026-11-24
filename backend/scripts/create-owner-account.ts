import { db, closeDatabase } from '../src/db/index.js';
import { hashPassword } from '../src/modules/auth/password.service.js';

/**
 * Tạo/đặt lại một tài khoản admin RIÊNG cho chủ hệ thống, dùng email KHÁC miền
 * '@crm-dk.local' nên `reset-dev-mfa` (chỉ nhắm '@crm-dk.local') KHÔNG bao giờ
 * xoá MFA của nó — đăng nhập ổn định kể cả khi chạy smoke test.
 *
 * Đăng nhập lần đầu sẽ vào luồng đăng ký MFA (quét QR). Hãy đổi mật khẩu sau đó.
 */
const EMAIL = process.argv[2] ?? 'owner@clinic.local';
const PASSWORD = process.argv[3] ?? 'OwnerPass2026!';

async function main() {
  const role = await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow();
  const passwordHash = await hashPassword(PASSWORD);

  const existing = await db.selectFrom('users').select('id').where('email', '=', EMAIL).executeTakeFirst();
  if (existing) {
    await db.deleteFrom('mfa_secrets').where('user_id', '=', existing.id).execute();
    await db
      .updateTable('users')
      .set({ password_hash: passwordHash, role_id: role.id, status: 'active', mfa_enabled: false, failed_login_attempts: 0, locked_until: null })
      .where('id', '=', existing.id)
      .execute();
    console.log(`\n✅ Đã đặt lại tài khoản admin: ${EMAIL}`);
  } else {
    await db
      .insertInto('users')
      .values({ email: EMAIL, password_hash: passwordHash, full_name: 'Chủ Hệ Thống', role_id: role.id, mfa_enabled: false })
      .execute();
    console.log(`\n✅ Đã tạo tài khoản admin: ${EMAIL}`);
  }
  console.log(`   Mật khẩu  : ${PASSWORD}`);
  console.log('   Lần đăng nhập đầu sẽ hiện QR để đăng ký MFA. Smoke test KHÔNG đụng tài khoản này.\n');
  await closeDatabase();
}

main().catch(async (e) => {
  console.error(e);
  await closeDatabase();
  process.exit(1);
});
