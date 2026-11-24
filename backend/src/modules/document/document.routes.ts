import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './document.controller.js';

export const documentRouter: Router = Router();

documentRouter.use(authenticate);

documentRouter.get('/', authorize('document:read'), asyncHandler(controller.list));
documentRouter.post('/', authorize('document:write'), controller.uploadMiddleware, asyncHandler(controller.upload));
documentRouter.get('/:documentId/download', authorize('document:read'), asyncHandler(controller.download));
documentRouter.delete('/:documentId', authorize('document:write'), asyncHandler(controller.remove));
