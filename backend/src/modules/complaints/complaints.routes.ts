import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './complaints.controller.js';

export const complaintsRouter: Router = Router();
complaintsRouter.use(authenticate);

complaintsRouter.get('/patients/:patientId', authorize('complaint:read'), asyncHandler(controller.listByPatient));
complaintsRouter.post('/patients/:patientId', authorize('complaint:write'), asyncHandler(controller.create));
complaintsRouter.get('/:id', authorize('complaint:read'), asyncHandler(controller.getOne));
complaintsRouter.patch('/:id', authorize('complaint:write'), asyncHandler(controller.update));
