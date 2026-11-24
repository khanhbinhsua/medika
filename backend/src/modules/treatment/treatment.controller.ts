import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './treatment.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import {
  createPlanSchema,
  createFromTemplateSchema,
  addStepSchema,
  updateStepSchema,
  cancelPlanSchema,
  listPlansSchema,
  createTemplateSchema,
} from './treatment.schemas.js';

const idParam = z.object({ planId: z.string().uuid('Mã phác đồ không hợp lệ') });
const stepParam = z.object({
  planId: z.string().uuid('Mã phác đồ không hợp lệ'),
  stepId: z.string().uuid('Mã bước không hợp lệ'),
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

export async function create(req: Request, res: Response) {
  const input = createPlanSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.createPlan(input, actor(req), meta(req)));
}

export async function createFromTemplate(req: Request, res: Response) {
  const input = createFromTemplateSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.createFromTemplate(input, actor(req), meta(req)));
}

export async function list(req: Request, res: Response) {
  const { patientId } = listPlansSchema.parse(req.query);
  noStore(res);
  res.json(await service.listPlansForPatient(patientId, actor(req), meta(req)));
}

export async function getById(req: Request, res: Response) {
  const { planId } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.getPlan(planId, actor(req), meta(req)));
}

export async function history(req: Request, res: Response) {
  const { planId } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.getPlanHistory(planId));
}

export async function addStep(req: Request, res: Response) {
  const { planId } = idParam.parse(req.params);
  const input = addStepSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.addStep(planId, input, actor(req), meta(req)));
}

export async function updateStep(req: Request, res: Response) {
  const { planId, stepId } = stepParam.parse(req.params);
  const input = updateStepSchema.parse(req.body);
  noStore(res);
  res.json(await service.updateStep(planId, stepId, input, actor(req), meta(req)));
}

export async function submit(req: Request, res: Response) {
  const { planId } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.submitForApproval(planId, actor(req), meta(req)));
}

export async function approve(req: Request, res: Response) {
  const { planId } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.approvePlan(planId, actor(req), meta(req)));
}

export async function cancel(req: Request, res: Response) {
  const { planId } = idParam.parse(req.params);
  const { reason } = cancelPlanSchema.parse(req.body);
  noStore(res);
  res.json(await service.cancelPlan(planId, reason, actor(req), meta(req)));
}

export async function listTemplates(_req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await service.listTemplates());
}

export async function createTemplate(req: Request, res: Response) {
  const input = createTemplateSchema.parse(req.body);
  res.status(201).json(await service.createTemplate(input, actor(req), meta(req)));
}
