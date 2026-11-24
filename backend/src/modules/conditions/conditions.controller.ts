import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './conditions.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import { createConditionSchema, updateConditionSchema, createAllergySchema } from './conditions.schemas.js';

const patientParam = z.object({ patientId: z.string().uuid('Mã bệnh nhân không hợp lệ') });
const idParam = z.object({ id: z.string().uuid('Mã không hợp lệ') });

function actor(req: Request): Actor {
  return { id: req.user!.sub, email: req.user!.email };
}
function meta(req: Request): RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip };
}
function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
}

export async function get(req: Request, res: Response) {
  const { patientId } = patientParam.parse(req.params);
  noStore(res);
  res.json(await service.getForPatient(patientId, actor(req), meta(req)));
}

export async function addCondition(req: Request, res: Response) {
  const { patientId } = patientParam.parse(req.params);
  const input = createConditionSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.addCondition(patientId, input, actor(req), meta(req)));
}

export async function updateCondition(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const input = updateConditionSchema.parse(req.body);
  noStore(res);
  res.json(await service.updateCondition(id, input, actor(req), meta(req)));
}

export async function deleteCondition(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  await service.deleteCondition(id, actor(req), meta(req));
  res.status(204).end();
}

export async function addAllergy(req: Request, res: Response) {
  const { patientId } = patientParam.parse(req.params);
  const input = createAllergySchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.addAllergy(patientId, input, actor(req), meta(req)));
}

export async function deleteAllergy(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  await service.deleteAllergy(id, actor(req), meta(req));
  res.status(204).end();
}
