import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as service from './audit.service.js';

export const auditRouter: Router = Router();

auditRouter.use(authenticate);
// Toàn bộ khu vực này chỉ dành cho vai trò có quyền kiểm toán.
auditRouter.use(authorize('audit:read'));

const isoDateTime = z.string().datetime({ offset: true });

const listAuditSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().trim().max(100).optional(),
  actorId: z.string().uuid().optional(),
  outcome: z.enum(['success', 'failure', 'denied']).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});

const listPhiSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  patientId: z.string().uuid().optional(),
  accessedBy: z.string().uuid().optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});

const anomalySchema = z.object({
  windowHours: z.coerce.number().int().min(1).max(720).default(24),
});

function noStore(res: import('express').Response) {
  res.setHeader('Cache-Control', 'no-store');
}

auditRouter.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const query = listAuditSchema.parse(req.query);
    noStore(res);
    res.json(await service.listAuditLogs(query));
  }),
);

auditRouter.get(
  '/phi-access',
  asyncHandler(async (req, res) => {
    const query = listPhiSchema.parse(req.query);
    noStore(res);
    res.json(await service.listPhiAccess(query));
  }),
);

auditRouter.get(
  '/integrity',
  asyncHandler(async (_req, res) => {
    noStore(res);
    res.json(await service.verifyIntegrity());
  }),
);

auditRouter.get(
  '/anomalies',
  asyncHandler(async (req, res) => {
    const { windowHours } = anomalySchema.parse(req.query);
    noStore(res);
    res.json({ windowHours, anomalies: await service.detectAnomalies(windowHours) });
  }),
);

auditRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    noStore(res);
    res.json(await service.complianceSummary());
  }),
);
