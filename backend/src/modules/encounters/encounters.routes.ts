import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './encounters.controller.js';

export const encounterRouter: Router = Router();
encounterRouter.use(authenticate);

encounterRouter.post('/', authorize('encounter:write'), asyncHandler(controller.create));
encounterRouter.get('/patients/:patientId', authorize('encounter:read'), asyncHandler(controller.byPatient));
encounterRouter.get('/:id', authorize('encounter:read'), asyncHandler(controller.get));
encounterRouter.patch('/:id', authorize('encounter:write'), asyncHandler(controller.update));
encounterRouter.post('/:id/sign', authorize('encounter:write'), asyncHandler(controller.sign));
encounterRouter.post('/:id/amend', authorize('encounter:write'), asyncHandler(controller.amend));
encounterRouter.get('/:id/versions', authorize('encounter:read'), asyncHandler(controller.versions));
