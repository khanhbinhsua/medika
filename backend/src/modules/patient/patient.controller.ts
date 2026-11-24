import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './patient.service.js';
import * as portalService from '../portal/portal.service.js';
import {
  createPatientSchema,
  updatePatientSchema,
  listPatientsSchema,
  listDeletedPatientsSchema,
  purgePatientSchema,
} from './patient.schemas.js';

const idParam = z.object({ patientId: z.string().uuid('Mã bệnh nhân không hợp lệ') });

function actor(req: Request): service.Actor {
  return { id: req.user!.sub, email: req.user!.email };
}

function meta(req: Request): service.RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip };
}

/** Phản hồi chứa PHI không được để trình duyệt hoặc proxy trung gian cache lại. */
function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
}

export async function create(req: Request, res: Response) {
  const input = createPatientSchema.parse(req.body);
  const patient = await service.createPatient(input, actor(req), meta(req));
  noStore(res);
  res.status(201).json(patient);
}

export async function list(req: Request, res: Response) {
  const query = listPatientsSchema.parse(req.query);
  noStore(res);
  res.json(await service.listPatients(query, actor(req), meta(req)));
}

export async function getById(req: Request, res: Response) {
  const { patientId } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.getPatient(patientId, actor(req), meta(req)));
}

export async function update(req: Request, res: Response) {
  const { patientId } = idParam.parse(req.params);
  const input = updatePatientSchema.parse(req.body);
  noStore(res);
  res.json(await service.updatePatient(patientId, input, actor(req), meta(req)));
}

export async function remove(req: Request, res: Response) {
  const { patientId } = idParam.parse(req.params);
  await service.softDeletePatient(patientId, actor(req), meta(req));
  res.status(204).send();
}

export async function listDeleted(req: Request, res: Response) {
  const query = listDeletedPatientsSchema.parse(req.query);
  noStore(res);
  res.json(await service.listDeletedPatients(query, actor(req), meta(req)));
}

export async function purge(req: Request, res: Response) {
  const { patientId } = idParam.parse(req.params);
  const { reason } = purgePatientSchema.parse(req.body);
  await service.purgePatient(patientId, reason, actor(req), meta(req));
  res.status(204).send();
}

const portalAccountSchema = z.object({ loginEmail: z.string().email('Email không hợp lệ').toLowerCase() });

export async function createPortalAccount(req: Request, res: Response) {
  const { patientId } = idParam.parse(req.params);
  const { loginEmail } = portalAccountSchema.parse(req.body);
  const result = await portalService.createAccount(patientId, loginEmail, actor(req), meta(req));
  noStore(res);
  res.status(201).json(result);
}
