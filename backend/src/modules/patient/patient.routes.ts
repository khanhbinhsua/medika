import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './patient.controller.js';

export const patientRouter: Router = Router();

patientRouter.use(authenticate);

patientRouter.get('/', authorize('patient:read'), asyncHandler(controller.list));
patientRouter.post('/', authorize('patient:write'), asyncHandler(controller.create));

// Đường dẫn cố định /deleted phải đứng TRƯỚC /:patientId, nếu không Express
// sẽ khớp "deleted" vào param patientId (rồi 400 vì không phải UUID).
patientRouter.get('/deleted', authorize('patient:purge'), asyncHandler(controller.listDeleted));

patientRouter.get('/:patientId', authorize('patient:read'), asyncHandler(controller.getById));
patientRouter.patch('/:patientId', authorize('patient:write'), asyncHandler(controller.update));
patientRouter.delete('/:patientId', authorize('patient:delete'), asyncHandler(controller.remove));
patientRouter.post('/:patientId/purge', authorize('patient:purge'), asyncHandler(controller.purge));
patientRouter.post('/:patientId/portal-account', authorize('portal:manage'), asyncHandler(controller.createPortalAccount));
