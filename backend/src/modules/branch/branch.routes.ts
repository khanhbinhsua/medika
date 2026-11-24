import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './branch.controller.js';

export const branchRouter: Router = Router();

branchRouter.use(authenticate);

// Chi nhánh của tôi (chọn trên topbar) — mọi nhân viên.
branchRouter.get('/', authorize('branch:read'), asyncHandler(controller.mine));

// Quản trị chi nhánh.
branchRouter.get('/all', authorize('branch:manage'), asyncHandler(controller.all));
branchRouter.post('/', authorize('branch:manage'), asyncHandler(controller.create));
branchRouter.patch('/:id', authorize('branch:manage'), asyncHandler(controller.update));
branchRouter.get('/:id/users', authorize('branch:manage'), asyncHandler(controller.users));
branchRouter.post('/:id/users', authorize('branch:manage'), asyncHandler(controller.assign));
branchRouter.delete('/:id/users/:userId', authorize('branch:manage'), asyncHandler(controller.unassign));
