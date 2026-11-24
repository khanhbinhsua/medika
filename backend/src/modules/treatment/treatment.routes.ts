import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './treatment.controller.js';

export const treatmentRouter: Router = Router();

treatmentRouter.use(authenticate);

// Template mẫu (đặt trước '/:planId' để không bị nuốt bởi route param).
treatmentRouter.get('/templates', authorize('treatment:read'), asyncHandler(controller.listTemplates));
treatmentRouter.post('/templates', authorize('treatment:write'), asyncHandler(controller.createTemplate));

treatmentRouter.get('/', authorize('treatment:read'), asyncHandler(controller.list));
treatmentRouter.post('/', authorize('treatment:write'), asyncHandler(controller.create));
treatmentRouter.post('/from-template', authorize('treatment:write'), asyncHandler(controller.createFromTemplate));

treatmentRouter.get('/:planId', authorize('treatment:read'), asyncHandler(controller.getById));
treatmentRouter.get('/:planId/history', authorize('treatment:read'), asyncHandler(controller.history));

treatmentRouter.post('/:planId/steps', authorize('treatment:write'), asyncHandler(controller.addStep));
treatmentRouter.patch('/:planId/steps/:stepId', authorize('treatment:write'), asyncHandler(controller.updateStep));

treatmentRouter.post('/:planId/submit', authorize('treatment:write'), asyncHandler(controller.submit));
treatmentRouter.post('/:planId/approve', authorize('treatment:approve'), asyncHandler(controller.approve));
treatmentRouter.post('/:planId/cancel', authorize('treatment:write'), asyncHandler(controller.cancel));
