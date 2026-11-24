import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './marketing.controller.js';

export const marketingRouter: Router = Router();

marketingRouter.use(authenticate);

// ── Nhóm khách hàng ─────────────────────────────────────────────────────
marketingRouter.get('/segments', authorize('marketing:read'), asyncHandler(controller.listSegments));
marketingRouter.post('/segments', authorize('marketing:manage'), asyncHandler(controller.createSegment));
marketingRouter.post('/segments/preview', authorize('marketing:read'), asyncHandler(controller.previewSegment));
marketingRouter.get('/segments/:id/preview', authorize('marketing:read'), asyncHandler(controller.previewSegment));
marketingRouter.patch('/segments/:id', authorize('marketing:manage'), asyncHandler(controller.updateSegment));
marketingRouter.delete('/segments/:id', authorize('marketing:manage'), asyncHandler(controller.deleteSegment));

// ── Chiến dịch ──────────────────────────────────────────────────────────
marketingRouter.get('/campaigns', authorize('marketing:read'), asyncHandler(controller.listCampaigns));
marketingRouter.post('/campaigns', authorize('marketing:manage'), asyncHandler(controller.createCampaign));
marketingRouter.post('/campaigns/:id/send', authorize('marketing:manage'), asyncHandler(controller.sendCampaign));
marketingRouter.get('/campaigns/:id/report', authorize('marketing:read'), asyncHandler(controller.campaignReport));

// ── Chăm sóc hậu điều trị ─────────────────────────────────────────────────
marketingRouter.post('/care', authorize('marketing:manage'), asyncHandler(controller.createCare));
marketingRouter.get('/care/patient/:patientId', authorize('marketing:read'), asyncHandler(controller.listCare));
marketingRouter.post('/care/dispatch', authorize('marketing:manage'), asyncHandler(controller.dispatchCare));

// ── Sinh nhật + báo cáo ────────────────────────────────────────────────────
marketingRouter.post('/birthday/dispatch', authorize('marketing:manage'), asyncHandler(controller.dispatchBirthday));
marketingRouter.get('/reports/retention', authorize('marketing:read'), asyncHandler(controller.retention));
