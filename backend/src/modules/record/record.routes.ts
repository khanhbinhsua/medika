import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './record.controller.js';

// Module đơn thuốc (đã lược bỏ bệnh án SOAP). `record:read` giữ cho việc xem đơn.
export const prescriptionRouter: Router = Router();

prescriptionRouter.use(authenticate);

prescriptionRouter.get('/', authorize('record:read'), asyncHandler(controller.listPrescriptions));
// Kê đơn là quyền riêng: y tá đọc được nhưng không được kê thuốc.
prescriptionRouter.post('/', authorize('prescription:write'), asyncHandler(controller.createPrescription));
