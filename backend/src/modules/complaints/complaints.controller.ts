import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './complaints.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import { createComplaintSchema, updateComplaintSchema } from './complaints.schemas.js';

const idParam = z.object({ id: z.string().uuid('Mã khiếu nại không hợp lệ') });
const patientParam = z.object({ patientId: z.string().uuid('Mã bệnh nhân không hợp lệ') });

function actor(req: Request): Actor { return { id: req.user!.sub, email: req.user!.email }; }
function meta(req: Request): RequestMeta { return { requestId: req.requestId, ipAddress: req.ip }; }
function noStore(res: Response) { res.setHeader('Cache-Control', 'no-store'); }

export async function listByPatient(req: Request, res: Response) {
  const { patientId } = patientParam.parse(req.params);
  noStore(res);
  res.json(await service.listByPatient(patientId));
}
export async function getOne(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.getOne(id, actor(req), meta(req)));
}
export async function create(req: Request, res: Response) {
  const { patientId } = patientParam.parse(req.params);
  const input = createComplaintSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.create(patientId, input, actor(req), meta(req)));
}
export async function update(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const input = updateComplaintSchema.parse(req.body);
  noStore(res);
  res.json(await service.update(id, input, actor(req), meta(req)));
}
