import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './marketing.service.js';
import { db } from '../../db/index.js';
import { writeAuditLog } from '../../audit/audit-logger.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import {
  createSegmentSchema,
  updateSegmentSchema,
  previewSchema,
  createCampaignSchema,
  createCareSchema,
  birthdaySchema,
} from './marketing.schemas.js';

const idParam = z.object({ id: z.string().uuid('Mã không hợp lệ') });
const patientParam = z.object({ patientId: z.string().uuid('Mã bệnh nhân không hợp lệ') });

function actor(req: Request): Actor {
  return { id: req.user!.sub, email: req.user!.email };
}
function meta(req: Request): RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip };
}
function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
}

// ── Segments ────────────────────────────────────────────────────────────────
export async function createSegment(req: Request, res: Response) {
  const input = createSegmentSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.createSegment(input, actor(req), meta(req)));
}
export async function listSegments(_req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await service.listSegments());
}
export async function updateSegment(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const input = updateSegmentSchema.parse(req.body);
  noStore(res);
  res.json(await service.updateSegment(id, input));
}
export async function deleteSegment(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  await service.deleteSegment(id);
  res.status(204).end();
}
export async function previewSegment(req: Request, res: Response) {
  // Preview theo id (GET) hoặc theo criteria tuỳ ý (POST body).
  noStore(res);
  if (req.method === 'GET') {
    const { id } = idParam.parse(req.params);
    res.json(await service.previewSegment(id, actor(req), meta(req)));
  } else {
    const { criteria } = previewSchema.parse(req.body);
    res.json(await service.previewSegment(criteria, actor(req), meta(req)));
  }
}

// ── Campaigns ───────────────────────────────────────────────────────────────
export async function createCampaign(req: Request, res: Response) {
  const input = createCampaignSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.createCampaign(input, actor(req), meta(req)));
}
export async function listCampaigns(_req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await service.listCampaigns());
}
export async function sendCampaign(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.sendCampaign(id, actor(req), meta(req)));
}
export async function campaignReport(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.campaignReport(id));
}

// ── Chăm sóc hậu điều trị ─────────────────────────────────────────────────
export async function createCare(req: Request, res: Response) {
  const input = createCareSchema.parse(req.body);
  const id = await db.transaction().execute(async (trx) => {
    const careId = await service.schedulePostCare(trx, { ...input, createdBy: actor(req).id });
    await writeAuditLog(trx, {
      requestId: req.requestId,
      actorId: req.user!.sub,
      actorEmail: req.user!.email,
      action: 'POST_CARE_CREATE',
      entityType: 'post_treatment_care',
      entityId: careId,
      reason: `type=${input.careType}`,
      ipAddress: req.ip,
    });
    return careId;
  });
  noStore(res);
  res.status(201).json({ id });
}
export async function listCare(req: Request, res: Response) {
  const { patientId } = patientParam.parse(req.params);
  noStore(res);
  res.json(await service.listCareForPatient(patientId));
}
export async function dispatchCare(req: Request, res: Response) {
  const result = await service.dispatchDueCare();
  await db.transaction().execute((trx) =>
    writeAuditLog(trx, {
      requestId: req.requestId,
      actorId: req.user!.sub,
      actorEmail: req.user!.email,
      action: 'POST_CARE_DISPATCH',
      reason: `sent=${result.sent} failed=${result.failed}`,
      ipAddress: req.ip,
    }),
  );
  res.json(result);
}

// ── Sinh nhật ────────────────────────────────────────────────────────────
export async function dispatchBirthday(req: Request, res: Response) {
  const { message } = birthdaySchema.parse(req.body);
  const result = await service.dispatchBirthday(message);
  await db.transaction().execute((trx) =>
    writeAuditLog(trx, {
      requestId: req.requestId,
      actorId: req.user!.sub,
      actorEmail: req.user!.email,
      action: 'BIRTHDAY_DISPATCH',
      reason: `matched=${result.matched} sent=${result.sent}`,
      ipAddress: req.ip,
    }),
  );
  res.json(result);
}

// ── Báo cáo ────────────────────────────────────────────────────────────────
export async function retention(_req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await service.retentionReport());
}
