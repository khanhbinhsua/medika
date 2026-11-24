import type { Request, Response } from 'express';
import * as service from './record.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import { createPrescriptionSchema, listPrescriptionsSchema } from './record.schemas.js';

function actor(req: Request): Actor {
  return { id: req.user!.sub, email: req.user!.email };
}

function meta(req: Request): RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip };
}

function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
}

export async function createPrescription(req: Request, res: Response) {
  const input = createPrescriptionSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.createPrescription(input, actor(req), meta(req)));
}

export async function listPrescriptions(req: Request, res: Response) {
  const query = listPrescriptionsSchema.parse(req.query);
  noStore(res);
  res.json(await service.listPrescriptions(query, actor(req), meta(req)));
}
