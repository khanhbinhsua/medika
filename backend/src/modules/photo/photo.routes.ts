import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './photo.controller.js';

export const photoRouter: Router = Router();

photoRouter.use(authenticate);

photoRouter.get('/', authorize('photo:read'), asyncHandler(controller.list));
photoRouter.post('/', authorize('photo:write'), controller.uploadMiddleware, asyncHandler(controller.upload));
photoRouter.get('/:photoId/image', authorize('photo:read'), asyncHandler(controller.image));
photoRouter.delete('/:photoId', authorize('photo:write'), asyncHandler(controller.remove));
