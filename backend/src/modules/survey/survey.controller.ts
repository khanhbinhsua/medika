import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './survey.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import {
  createSurveySchema,
  updateSurveySchema,
  sendInviteSchema,
  dispatchAutoSchema,
  respondSchema,
} from './survey.schemas.js';

const idParam = z.object({ id: z.string().uuid('Mã khảo sát không hợp lệ') });
const tokenParam = z.object({ token: z.string().min(10).max(200) });

function actor(req: Request): Actor {
  return { id: req.user!.sub, email: req.user!.email };
}
function meta(req: Request): RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip };
}
function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
}

// ── Quản lý khảo sát (staff) ────────────────────────────────────────────────
export async function create(req: Request, res: Response) {
  const input = createSurveySchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.createSurvey(input, actor(req), meta(req)));
}
export async function list(_req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await service.listSurveys());
}
export async function getById(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.getSurvey(id));
}
export async function update(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const input = updateSurveySchema.parse(req.body);
  noStore(res);
  res.json(await service.updateSurvey(id, input));
}

export async function sendInvite(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const input = sendInviteSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.sendInvite(id, input, actor(req), meta(req)));
}
export async function dispatchAuto(req: Request, res: Response) {
  const { surveyId, sinceHours } = dispatchAutoSchema.parse(req.body);
  noStore(res);
  res.json(await service.dispatchAuto(surveyId, sinceHours ?? 48, actor(req), meta(req)));
}

// ── Báo cáo ────────────────────────────────────────────────────────────────
export async function report(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.surveyReport(id));
}
export async function trend(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.surveyTrend(id));
}
export async function negative(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.listNegative(id, actor(req), meta(req)));
}

// ── Công khai (không đăng nhập, bảo vệ bằng token trong link) ────────────────
export async function publicView(req: Request, res: Response) {
  const { token } = tokenParam.parse(req.params);
  noStore(res);
  res.json(await service.getPublicByToken(token));
}
export async function respond(req: Request, res: Response) {
  const { token } = tokenParam.parse(req.params);
  const input = respondSchema.parse(req.body);
  noStore(res);
  res.json(await service.submitResponse(token, input, meta(req)));
}
