import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './booking.controller.js';

// Public — đặt lịch online (không đăng nhập). Mount trước router nhân sự.
export const bookingPublicRouter: Router = Router();
bookingPublicRouter.get('/branches', asyncHandler(controller.publicBranches));
bookingPublicRouter.get('/slots', asyncHandler(controller.publicSlots));
bookingPublicRouter.post('/', asyncHandler(controller.publicCreate));

// Nhân sự — hộp chờ xác nhận.
export const bookingRouter: Router = Router();
bookingRouter.use(authenticate);
bookingRouter.get('/', authorize('booking:manage'), asyncHandler(controller.pending));
bookingRouter.get('/:id/matches', authorize('booking:manage'), asyncHandler(controller.matches));
bookingRouter.post('/:id/confirm', authorize('booking:manage'), asyncHandler(controller.confirm));
bookingRouter.post('/:id/reject', authorize('booking:manage'), asyncHandler(controller.reject));
