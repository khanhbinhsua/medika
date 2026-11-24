import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './spending.controller.js';

export const spendingRouter: Router = Router();

spendingRouter.use(authenticate);

// Danh mục hạng VIP + khách chi nhiều nhất (đặt trước route param).
spendingRouter.get('/tiers', authorize('spending:read'), asyncHandler(controller.tiers));
spendingRouter.get('/top', authorize('spending:read'), asyncHandler(controller.top));
spendingRouter.post('/import', authorize('spending:write'), asyncHandler(controller.importRows));

// Theo bệnh nhân.
spendingRouter.get('/patients/:patientId/summary', authorize('spending:read'), asyncHandler(controller.summary));
spendingRouter.get('/patients/:patientId/transactions', authorize('spending:read'), asyncHandler(controller.list));
spendingRouter.post('/patients/:patientId/transactions', authorize('spending:write'), asyncHandler(controller.add));

// Sửa/xoá 1 khoản chi.
spendingRouter.patch('/transactions/:id', authorize('spending:write'), asyncHandler(controller.update));
spendingRouter.delete('/transactions/:id', authorize('spending:write'), asyncHandler(controller.remove));
