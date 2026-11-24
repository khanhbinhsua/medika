import { db } from '../../db/index.js';
import { writeAuditLog } from '../../audit/audit-logger.js';
import { NotFoundError, ConflictError, ValidationError } from '../../middleware/errors.js';
import { hashPassword } from '../auth/password.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import type { CreateUserInput, UpdateUserInput } from './user.schemas.js';

export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

function toDto(r: {
  id: string;
  email: string;
  full_name: string;
  role_name: string;
  status: string;
  mfa_enabled: boolean;
  last_login_at: Date | null;
  created_at: Date;
}): UserDto {
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    role: r.role_name,
    status: r.status,
    mfaEnabled: r.mfa_enabled,
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
  };
}

export async function listUsers(): Promise<UserDto[]> {
  const rows = await db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select([
      'users.id',
      'users.email',
      'users.full_name',
      'roles.name as role_name',
      'users.status',
      'users.mfa_enabled',
      'users.last_login_at',
      'users.created_at',
    ])
    .orderBy('users.full_name', 'asc')
    .execute();
  return rows.map(toDto);
}

export async function listRoles(): Promise<{ name: string; description: string }[]> {
  return db.selectFrom('roles').select(['name', 'description']).orderBy('name', 'asc').execute();
}

async function roleIdByName(name: string): Promise<string> {
  const role = await db.selectFrom('roles').select('id').where('name', '=', name).executeTakeFirst();
  if (!role) throw new ValidationError(`Vai trò không hợp lệ: ${name}`);
  return role.id;
}

async function getUserDto(id: string): Promise<UserDto> {
  const row = await db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select([
      'users.id',
      'users.email',
      'users.full_name',
      'roles.name as role_name',
      'users.status',
      'users.mfa_enabled',
      'users.last_login_at',
      'users.created_at',
    ])
    .where('users.id', '=', id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('Tài khoản');
  return toDto(row);
}

export async function createUser(input: CreateUserInput, actor: Actor, meta: RequestMeta): Promise<UserDto> {
  const roleId = await roleIdByName(input.role);
  const passwordHash = await hashPassword(input.password);

  const inserted = await db
    .insertInto('users')
    .values({
      email: input.email,
      password_hash: passwordHash,
      full_name: input.fullName,
      role_id: roleId,
      // Nhân viên mới CHƯA có MFA — lần đăng nhập đầu sẽ vào luồng đăng ký MFA.
      mfa_enabled: false,
      created_by: actor.id,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
    .catch((err: unknown) => {
      if ((err as { code?: string }).code === '23505') throw new ConflictError('Email này đã được sử dụng');
      throw err;
    });

  await db.transaction().execute((trx) =>
    writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'USER_CREATE',
      entityType: 'user',
      entityId: inserted.id,
      reason: `role=${input.role} email=${input.email}`,
      ipAddress: meta.ipAddress,
    }),
  );
  return getUserDto(inserted.id);
}

/** Đếm admin còn hoạt động — chặn tự khoá tổ chức khi hạ/khoá admin cuối cùng. */
async function activeAdminCount(): Promise<number> {
  const row = await db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select((eb) => eb.fn.countAll<string>().as('c'))
    .where('roles.name', '=', 'admin')
    .where('users.status', '=', 'active')
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

export async function updateUser(id: string, input: UpdateUserInput, actor: Actor, meta: RequestMeta): Promise<UserDto> {
  const current = await getUserDto(id);

  // Chặn tự khoá/tự hạ quyền chính mình (tránh vô tình mất quyền quản trị).
  if (id === actor.id) {
    if (input.status && input.status !== 'active') throw new ValidationError('Không thể tự khoá tài khoản của chính mình');
    if (input.role && input.role !== current.role) throw new ValidationError('Không thể tự đổi vai trò của chính mình');
  }

  // Chặn hạ/khoá admin hoạt động CUỐI CÙNG.
  const losingAdmin =
    current.role === 'admin' &&
    current.status === 'active' &&
    ((input.role && input.role !== 'admin') || (input.status && input.status !== 'active'));
  if (losingAdmin && (await activeAdminCount()) <= 1) {
    throw new ValidationError('Phải còn ít nhất một quản trị viên đang hoạt động');
  }

  const patch: Record<string, unknown> = {};
  if (input.fullName !== undefined) patch.full_name = input.fullName;
  if (input.role !== undefined) patch.role_id = await roleIdByName(input.role);
  if (input.status !== undefined) patch.status = input.status;

  await db.transaction().execute(async (trx) => {
    await trx.updateTable('users').set(patch).where('id', '=', id).execute();
    // Khoá/vô hiệu hoá → thu hồi mọi phiên đang mở để chặn truy cập ngay.
    if (input.status && input.status !== 'active') {
      await trx
        .updateTable('sessions')
        .set({ revoked_at: new Date(), revoked_reason: 'account_' + input.status })
        .where('user_id', '=', id)
        .where('revoked_at', 'is', null)
        .execute();
    }
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'USER_UPDATE',
      entityType: 'user',
      entityId: id,
      reason: Object.keys(input).map((k) => `${k}=${String((input as Record<string, unknown>)[k])}`).join(' '),
      ipAddress: meta.ipAddress,
    });
  });
  return getUserDto(id);
}

export async function resetPassword(id: string, newPassword: string, actor: Actor, meta: RequestMeta): Promise<void> {
  await getUserDto(id); // đảm bảo tồn tại
  const passwordHash = await hashPassword(newPassword);
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('users')
      .set({ password_hash: passwordHash, password_changed_at: new Date(), failed_login_attempts: 0, locked_until: null })
      .where('id', '=', id)
      .execute();
    // Đổi mật khẩu → thu hồi mọi phiên, buộc đăng nhập lại.
    await trx
      .updateTable('sessions')
      .set({ revoked_at: new Date(), revoked_reason: 'password_reset' })
      .where('user_id', '=', id)
      .where('revoked_at', 'is', null)
      .execute();
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'USER_PASSWORD_RESET',
      entityType: 'user',
      entityId: id,
      ipAddress: meta.ipAddress,
    });
  });
}

/** Gỡ MFA của nhân viên (khôi phục khi mất thiết bị) — lần đăng nhập sau đăng ký lại. */
export async function resetMfa(id: string, actor: Actor, meta: RequestMeta): Promise<void> {
  await getUserDto(id);
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('mfa_secrets').where('user_id', '=', id).execute();
    await trx.updateTable('users').set({ mfa_enabled: false }).where('id', '=', id).execute();
    await trx
      .updateTable('sessions')
      .set({ revoked_at: new Date(), revoked_reason: 'mfa_reset' })
      .where('user_id', '=', id)
      .where('revoked_at', 'is', null)
      .execute();
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'USER_MFA_RESET',
      entityType: 'user',
      entityId: id,
      ipAddress: meta.ipAddress,
    });
  });
}
