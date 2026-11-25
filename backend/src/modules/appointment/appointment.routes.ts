import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './appointment.controller.js';

export const appointmentRouter: Router = Router();

appointmentRouter.use(authenticate);

appointmentRouter.get('/', authorize('appointment:read'), asyncHandler(controller.list));
appointmentRouter.get('/counts', authorize('appointment:read'), asyncHandler(controller.counts));
appointmentRouter.post('/', authorize('appointment:write'), asyncHandler(controller.create));
appointmentRouter.get('/:appointmentId', authorize('appointment:read'), asyncHandler(controller.getById));
appointmentRouter.patch('/:appointmentId', authorize('appointment:write'), asyncHandler(controller.update));
appointmentRouter.post('/:appointmentId/status', authorize('appointment:write'), asyncHandler(controller.changeStatus));
appointmentRouter.post('/:appointmentId/cancel', authorize('appointment:cancel'), asyncHandler(controller.cancel));
