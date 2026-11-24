import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './encounters.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import { createEncounterSchema, updateEncounterSchema, amendEncounterSchema } from './encounters.schemas.js';

const idParam = z.object({ id: z.string().uuid('Mã bệnh án không hợp lệ') });
const patientParam = z.object({ patientId: z.string().uuid('Mã bệnh nhân không hợp lệ') });
function actor(req: Request): Actor { return { id: req.user!.sub, email: req.user!.email }; }
function meta(req: Request): RequestMeta { return { requestId: req.requestId, ipAddress: req.ip }; }
function noStore(res: Response) { res.setHeader('Cache-Control', 'no-store'); }

export async function create(req: Request, res: Response) {
  const input = createEncounterSchema.parse(req.body); noStore(res);
  res.status(201).json(await service.createEncounter(input, actor(req), meta(req)));
}
export async function get(req: Request, res: Response) {
  const { id } = idParam.parse(req.params); noStore(res);
  res.json(await service.getEncounter(id, actor(req), meta(req)));
}
export async function update(req: Request, res: Response) {
  const { id } = idParam.parse(req.params); const input = updateEncounterSchema.parse(req.body); noStore(res);
  res.json(await service.updateEncounter(id, input, actor(req), meta(req)));
}
export async function sign(req: Request, res: Response) {
  const { id } = idParam.parse(req.params); noStore(res);
  res.json(await service.signEncounter(id, actor(req), meta(req)));
}
export async function amend(req: Request, res: Response) {
  const { id } = idParam.parse(req.params); const input = amendEncounterSchema.parse(req.body); noStore(res);
  res.json(await service.amendEncounter(id, input, actor(req), meta(req)));
}
export async function versions(req: Request, res: Response) {
  const { id } = idParam.parse(req.params); noStore(res);
  res.json(await service.listVersions(id, actor(req), meta(req)));
}
export async function byPatient(req: Request, res: Response) {
  const { patientId } = patientParam.parse(req.params); noStore(res);
  res.json(await service.listByPatient(patientId));
}
