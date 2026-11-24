import { db } from '../../db/index.js';
import { writeAuditLog } from '../../audit/audit-logger.js';
import { NotFoundError } from '../../middleware/errors.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import type { CreateBranchInput, UpdateBranchInput } from './branch.schemas.js';

export interface BranchDto {
  id: string;
  code: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  slotCapacity: number | null;
  geoRadiusM: number | null;
  isDefault: boolean;
  active: boolean;
  createdAt: string;
}

interface BranchRow {
  id: string;
  code: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  slot_capacity: number | null;
  geo_radius_m: number | null;
  is_default: boolean;
  active: boolean;
  created_at: Date;
}

function toDto(r: BranchRow): BranchDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    address: r.address,
    phone: r.phone,
    slotCapacity: r.slot_capacity,
    geoRadiusM: r.geo_radius_m,
    isDefault: r.is_default,
    active: r.active,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** Chi nhánh mặc định — dùng để gắn branch_id khi tạo lịch hẹn chưa chọn chi nhánh. */
export async function getDefaultBranchId(): Promise<string | null> {
  const row = await db.selectFrom('branches').select('id').where('is_default', '=', true).executeTakeFirst();
  return row?.id ?? null;
}

/** Chi nhánh mà nhân viên được phân công (để chọn trên topbar). */
export async function listMyBranches(userId: string): Promise<BranchDto[]> {
  const rows = await db
    .selectFrom('branches')
    .innerJoin('user_branches', 'user_branches.branch_id', 'branches.id')
    .selectAll('branches')
    .where('user_branches.user_id', '=', userId)
    .where('branches.active', '=', true)
    .orderBy('branches.is_default', 'desc')
    .orderBy('branches.name')
    .execute();
  return rows.map(toDto);
}

/** Toàn bộ chi nhánh (quản trị). */
export async function listAllBranches(): Promise<BranchDto[]> {
  const rows = await db
    .selectFrom('branches')
    .selectAll()
    .orderBy('is_default', 'desc')
    .orderBy('name')
    .execute();
  return rows.map(toDto);
}

export async function createBranch(input: CreateBranchInput, actor: Actor, meta: RequestMeta): Promise<BranchDto> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto('branches')
      .values({
        name: input.name,
        code: input.code ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
        slot_capacity: input.slotCapacity ?? null,
        geo_radius_m: input.geoRadiusM ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'BRANCH_CREATE',
      entityType: 'branch',
      entityId: row.id,
      ipAddress: meta.ipAddress,
    });
    return toDto(row);
  });
}

export async function updateBranch(
  id: string,
  input: UpdateBranchInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<BranchDto> {
  const existing = await db.selectFrom('branches').select('id').where('id', '=', id).executeTakeFirst();
  if (!existing) throw new NotFoundError('Chi nhánh');

  return db.transaction().execute(async (trx) => {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.code !== undefined) patch.code = input.code;
    if (input.address !== undefined) patch.address = input.address;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.slotCapacity !== undefined) patch.slot_capacity = input.slotCapacity;
    if (input.geoRadiusM !== undefined) patch.geo_radius_m = input.geoRadiusM;
    if (input.active !== undefined) patch.active = input.active;

    const row = await trx
      .updateTable('branches')
      .set(patch)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'BRANCH_UPDATE',
      entityType: 'branch',
      entityId: id,
      ipAddress: meta.ipAddress,
    });
    return toDto(row);
  });
}

export async function assignUser(branchId: string, userId: string, actor: Actor, meta: RequestMeta): Promise<void> {
  const [branch, user] = await Promise.all([
    db.selectFrom('branches').select('id').where('id', '=', branchId).executeTakeFirst(),
    db.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst(),
  ]);
  if (!branch) throw new NotFoundError('Chi nhánh');
  if (!user) throw new NotFoundError('Nhân viên');

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('user_branches')
      .values({ branch_id: branchId, user_id: userId })
      .onConflict((oc) => oc.columns(['user_id', 'branch_id']).doNothing())
      .execute();
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'BRANCH_ASSIGN_USER',
      entityType: 'branch',
      entityId: branchId,
      reason: `user ${userId}`,
      ipAddress: meta.ipAddress,
    });
  });
}

export async function unassignUser(branchId: string, userId: string, actor: Actor, meta: RequestMeta): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom('user_branches')
      .where('branch_id', '=', branchId)
      .where('user_id', '=', userId)
      .execute();
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'BRANCH_UNASSIGN_USER',
      entityType: 'branch',
      entityId: branchId,
      reason: `user ${userId}`,
      ipAddress: meta.ipAddress,
    });
  });
}

/** Nhân viên thuộc một chi nhánh (quản trị). */
export async function listBranchUsers(branchId: string): Promise<{ id: string; fullName: string; email: string }[]> {
  const rows = await db
    .selectFrom('users')
    .innerJoin('user_branches', 'user_branches.user_id', 'users.id')
    .select(['users.id as id', 'users.full_name as fullName', 'users.email as email'])
    .where('user_branches.branch_id', '=', branchId)
    .orderBy('users.full_name')
    .execute();
  return rows;
}
