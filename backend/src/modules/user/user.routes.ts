import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import * as service from './user.service.js';
import { createUserSchema, updateUserSchema, resetPasswordSchema } from './user.schemas.js';

export const userRouter: Router = Router();

userRouter.use(authenticate);

function actor(req: Request): Actor {
  return { id: req.user!.sub, email: req.user!.email };
}
function meta(req: Request): RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip };
}
const idParam = z.object({ id: z.string().uuid('Mã tài khoản không hợp lệ') });

/**
 * Danh sách bác sĩ đang hoạt động, phục vụ ô chọn khi đặt lịch.
 * Chỉ trả tên và id — tên nhân viên không phải PHI nên không cần giải mã,
 * nhưng vẫn yêu cầu quyền đọc lịch hẹn để không lộ cơ cấu nhân sự ra ngoài.
 */
userRouter.get(
  '/doctors',
  authorize('appointment:read'),
  asyncHandler(async (_req, res) => {
    const doctors = await db
      .selectFrom('users')
      .innerJoin('roles', 'roles.id', 'users.role_id')
      .select(['users.id', 'users.full_name as fullName'])
      .where('roles.name', '=', 'doctor')
      .where('users.status', '=', 'active')
      .orderBy('users.full_name', 'asc')
      .execute();

    res.setHeader('Cache-Control', 'no-store');
    res.json(doctors);
  }),
);

// ── Quản lý tài khoản nhân viên (chỉ admin — quyền user:read/user:write) ─────

userRouter.get(
  '/roles',
  authorize('user:read'),
  asyncHandler(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.listRoles());
  }),
);

userRouter.get(
  '/',
  authorize('user:read'),
  asyncHandler(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.listUsers());
  }),
);

userRouter.post(
  '/',
  authorize('user:write'),
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json(await service.createUser(input, actor(req), meta(req)));
  }),
);

userRouter.patch(
  '/:id',
  authorize('user:write'),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const input = updateUserSchema.parse(req.body);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.updateUser(id, input, actor(req), meta(req)));
  }),
);

userRouter.post(
  '/:id/reset-password',
  authorize('user:write'),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { newPassword } = resetPasswordSchema.parse(req.body);
    await service.resetPassword(id, newPassword, actor(req), meta(req));
    res.status(204).end();
  }),
);

userRouter.post(
  '/:id/reset-mfa',
  authorize('user:write'),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    await service.resetMfa(id, actor(req), meta(req));
    res.status(204).end();
  }),
);
