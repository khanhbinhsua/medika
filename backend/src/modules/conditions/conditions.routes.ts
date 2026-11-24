import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './conditions.controller.js';

// Bệnh lý & Dị ứng — lớp lâm sàng nhẹ phục vụ cá nhân hoá chăm sóc + phân nhóm.
export const conditionsRouter: Router = Router();

conditionsRouter.use(authenticate);

conditionsRouter.get('/patients/:patientId', authorize('condition:read'), asyncHandler(controller.get));

conditionsRouter.post('/patients/:patientId/conditions', authorize('condition:write'), asyncHandler(controller.addCondition));
conditionsRouter.patch('/conditions/:id', authorize('condition:write'), asyncHandler(controller.updateCondition));
conditionsRouter.delete('/conditions/:id', authorize('condition:write'), asyncHandler(controller.deleteCondition));

conditionsRouter.post('/patients/:patientId/allergies', authorize('condition:write'), asyncHandler(controller.addAllergy));
conditionsRouter.delete('/allergies/:id', authorize('condition:write'), asyncHandler(controller.deleteAllergy));
