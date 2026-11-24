import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './billing.controller.js';

export const billingRouter: Router = Router();
billingRouter.use(authenticate);

billingRouter.get('/catalog', authorize('billing:read'), asyncHandler(controller.catalog));

// Sổ thanh toán + công nợ (đặt /receivables trước /:id).
billingRouter.get('/orders', authorize('billing:read'), asyncHandler(controller.listOrders));
billingRouter.get('/orders/receivables', authorize('billing:read'), asyncHandler(controller.receivables));
billingRouter.post('/orders', authorize('billing:manage'), asyncHandler(controller.createOrder));
billingRouter.get('/orders/:id', authorize('billing:read'), asyncHandler(controller.getOrder));
billingRouter.post('/orders/:id/lines', authorize('billing:manage'), asyncHandler(controller.addLine));
billingRouter.delete('/orders/:id/lines/:lineId', authorize('billing:manage'), asyncHandler(controller.removeLine));
billingRouter.post('/orders/:id/payments', authorize('billing:manage'), asyncHandler(controller.takePayment));
billingRouter.post('/orders/:id/cancel', authorize('billing:manage'), asyncHandler(controller.cancelOrder));

billingRouter.get('/patients/:patientId/orders', authorize('billing:read'), asyncHandler(controller.patientOrders));
