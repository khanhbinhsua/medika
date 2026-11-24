import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as service from './consent.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import type { Request } from 'express';

export const consentRouter: Router = Router();

consentRouter.use(authenticate);

const listSchema = z.object({ patientId: z.string().uuid('Mã bệnh nhân không hợp lệ') });

const recordSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
  consentType: z.enum(['treatment', 'privacy_notice', 'data_sharing', 'research', 'marketing']),
  granted: z.boolean(),
  documentVersion: z.string().trim().min(1, 'Cần ghi phiên bản văn bản đã ký').max(50),
  notes: z.string().trim().max(1000).optional(),
});

const idParam = z.object({ consentId: z.string().uuid('Mã bản ghi không hợp lệ') });

function actor(req: Request): Actor {
  return { id: req.user!.sub, email: req.user!.email };
}

function meta(req: Request): RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip };
}

consentRouter.get(
  '/',
  authorize('patient:read'),
  asyncHandler(async (req, res) => {
    const { patientId } = listSchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.listConsents(patientId));
  }),
);

// Ghi nhận đồng ý là hành vi pháp lý, cần quyền ghi hồ sơ bệnh nhân.
consentRouter.post(
  '/',
  authorize('patient:write'),
  asyncHandler(async (req, res) => {
    const input = recordSchema.parse(req.body);
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json(await service.recordConsent(input, actor(req), meta(req)));
  }),
);

consentRouter.post(
  '/:consentId/revoke',
  authorize('patient:write'),
  asyncHandler(async (req, res) => {
    const { consentId } = idParam.parse(req.params);
    await service.revokeConsent(consentId, actor(req), meta(req));
    res.status(204).send();
  }),
);
