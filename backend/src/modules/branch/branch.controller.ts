import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './branch.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import { createBranchSchema, updateBranchSchema, assignUserSchema } from './branch.schemas.js';

const idParam = z.object({ id: z.string().uuid('Mã chi nhánh không hợp lệ') });
const userParam = z.object({
  id: z.string().uuid('Mã chi nhánh không hợp lệ'),
  userId: z.string().uuid('Mã nhân viên không hợp lệ'),
});

function actor(req: Request): Actor {
  return { id: req.user!.sub, email: req.user!.email };
}
function meta(req: Request): RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip };
}
function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
}

export async function mine(req: Request, res: Response) {
  noStore(res);
  res.json(await service.listMyBranches(req.user!.sub));
}

export async function all(_req: Request, res: Response) {
  noStore(res);
  res.json(await service.listAllBranches());
}

export async function create(req: Request, res: Response) {
  const input = createBranchSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.createBranch(input, actor(req), meta(req)));
}

export async function update(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const input = updateBranchSchema.parse(req.body);
  noStore(res);
  res.json(await service.updateBranch(id, input, actor(req), meta(req)));
}

export async function users(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.listBranchUsers(id));
}

export async function assign(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { userId } = assignUserSchema.parse(req.body);
  await service.assignUser(id, userId, actor(req), meta(req));
  res.status(204).end();
}

export async function unassign(req: Request, res: Response) {
  const { id, userId } = userParam.parse(req.params);
  await service.unassignUser(id, userId, actor(req), meta(req));
  res.status(204).end();
}
