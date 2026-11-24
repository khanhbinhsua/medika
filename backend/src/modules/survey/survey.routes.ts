import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './survey.controller.js';

// ── Router công khai (KHÔNG đăng nhập) — bệnh nhân trả lời qua link ─────────
// Tách riêng để không dính middleware authenticate của router staff.
export const surveyPublicRouter: Router = Router();
surveyPublicRouter.get('/:token', asyncHandler(controller.publicView));
surveyPublicRouter.post('/:token', asyncHandler(controller.respond));

// ── Router staff (cần đăng nhập + quyền) ─────────────────────────────────────
export const surveyRouter: Router = Router();
surveyRouter.use(authenticate);

surveyRouter.get('/', authorize('survey:read'), asyncHandler(controller.list));
surveyRouter.post('/', authorize('survey:manage'), asyncHandler(controller.create));
surveyRouter.post('/dispatch-auto', authorize('survey:manage'), asyncHandler(controller.dispatchAuto));

surveyRouter.get('/:id', authorize('survey:read'), asyncHandler(controller.getById));
surveyRouter.patch('/:id', authorize('survey:manage'), asyncHandler(controller.update));
surveyRouter.post('/:id/invite', authorize('survey:manage'), asyncHandler(controller.sendInvite));
surveyRouter.get('/:id/report', authorize('survey:read'), asyncHandler(controller.report));
surveyRouter.get('/:id/trend', authorize('survey:read'), asyncHandler(controller.trend));
surveyRouter.get('/:id/negative', authorize('survey:read'), asyncHandler(controller.negative));
