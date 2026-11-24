import type { Kysely, Transaction } from 'kysely';
import { db } from '../../db/index.js';
import type { Database } from '../../db/types.js';

type Db = Kysely<Database> | Transaction<Database>;

export async function findUserByEmail(email: string) {
  return db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select([
      'users.id',
      'users.email',
      'users.password_hash',
      'users.full_name',
      'users.role_id',
      'users.status',
      'users.mfa_enabled',
      'users.failed_login_attempts',
      'users.locked_until',
      'roles.name as role_name',
    ])
    .where('users.email', '=', email)
    .executeTakeFirst();
}

export async function findUserById(userId: string) {
  return db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select([
      'users.id',
      'users.email',
      'users.full_name',
      'users.status',
      'users.mfa_enabled',
      'roles.name as role_name',
    ])
    .where('users.id', '=', userId)
    .executeTakeFirst();
}

export async function loadPermissions(roleId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('role_permissions')
    .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
    .select('permissions.code')
    .where('role_permissions.role_id', '=', roleId)
    .execute();

  return rows.map((r) => r.code);
}

export async function recordFailedLogin(userId: string, maxAttempts: number, lockMinutes: number) {
  const user = await db
    .selectFrom('users')
    .select('failed_login_attempts')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();

  const attempts = user.failed_login_attempts + 1;
  const shouldLock = attempts >= maxAttempts;

  await db
    .updateTable('users')
    .set({
      failed_login_attempts: attempts,
      locked_until: shouldLock ? new Date(Date.now() + lockMinutes * 60_000) : null,
    })
    .where('id', '=', userId)
    .execute();

  return { attempts, locked: shouldLock };
}

export async function resetFailedLogins(trx: Db, userId: string) {
  await trx
    .updateTable('users')
    .set({ failed_login_attempts: 0, locked_until: null, last_login_at: new Date() })
    .where('id', '=', userId)
    .execute();
}

export async function createSession(
  trx: Db,
  params: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  },
) {
  return trx
    .insertInto('sessions')
    .values({
      user_id: params.userId,
      refresh_token_hash: params.refreshTokenHash,
      expires_at: params.expiresAt,
      ip_address: params.ipAddress ?? null,
      user_agent: params.userAgent ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

export async function findSessionByRefreshHash(refreshTokenHash: string) {
  return db
    .selectFrom('sessions')
    .select(['id', 'user_id', 'expires_at', 'revoked_at', 'last_activity_at'])
    .where('refresh_token_hash', '=', refreshTokenHash)
    .executeTakeFirst();
}

export async function rotateRefreshToken(trx: Db, sessionId: string, newHash: string, expiresAt: Date) {
  await trx
    .updateTable('sessions')
    .set({ refresh_token_hash: newHash, expires_at: expiresAt, last_activity_at: new Date() })
    .where('id', '=', sessionId)
    .execute();
}

export async function revokeSession(trx: Db, sessionId: string, reason: string) {
  await trx
    .updateTable('sessions')
    .set({ revoked_at: new Date(), revoked_reason: reason })
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .execute();
}

export async function findMfaSecret(userId: string) {
  return db
    .selectFrom('mfa_secrets')
    .select(['user_id', 'secret_enc', 'dek_id', 'recovery_codes_hashed', 'confirmed_at'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

export async function upsertMfaSecret(
  trx: Db,
  params: { userId: string; secretEnc: Buffer; dekId: string; recoveryCodesHashed: string[] },
) {
  await trx
    .insertInto('mfa_secrets')
    .values({
      user_id: params.userId,
      secret_enc: params.secretEnc,
      dek_id: params.dekId,
      recovery_codes_hashed: params.recoveryCodesHashed,
      confirmed_at: null,
    })
    .onConflict((oc) =>
      oc.column('user_id').doUpdateSet({
        secret_enc: params.secretEnc,
        dek_id: params.dekId,
        recovery_codes_hashed: params.recoveryCodesHashed,
        confirmed_at: null,
      }),
    )
    .execute();
}

export async function confirmMfa(trx: Db, userId: string) {
  await trx.updateTable('mfa_secrets').set({ confirmed_at: new Date() }).where('user_id', '=', userId).execute();
  await trx.updateTable('users').set({ mfa_enabled: true }).where('id', '=', userId).execute();
}

export async function consumeRecoveryCode(trx: Db, userId: string, remaining: string[]) {
  await trx
    .updateTable('mfa_secrets')
    .set({ recovery_codes_hashed: remaining })
    .where('user_id', '=', userId)
    .execute();
}

/**
 * "Claim" một bước TOTP theo kiểu nguyên tử: chỉ ghi nếu bước đó mới hơn bước
 * đã dùng gần nhất. Trả về false nếu bước đã bị dùng (tái sử dụng mã) HOẶC
 * nếu thua một request đồng thời khác đang claim cùng lúc — cả hai trường hợp
 * đều phải từ chối, nên gộp kiểm tra và ghi vào một câu UPDATE ... WHERE duy
 * nhất thay vì đọc rồi ghi riêng (đọc-rồi-ghi sẽ có khoảng hở race condition).
 */
export async function claimTotpStep(trx: Db, userId: string, step: number): Promise<boolean> {
  const result = await trx
    .updateTable('mfa_secrets')
    .set({ last_used_step: String(step) })
    .where('user_id', '=', userId)
    .where((eb) => eb.or([eb('last_used_step', 'is', null), eb('last_used_step', '<', String(step))]))
    .executeTakeFirst();

  return result.numUpdatedRows > 0n;
}
