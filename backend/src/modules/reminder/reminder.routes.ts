import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { writeAuditLog } from '../../audit/audit-logger.js';
import { db } from '../../db/index.js';
import * as service from './reminder.service.js';

export const reminderRouter: Router = Router();

reminderRouter.use(authenticate);

const apptParam = z.object({ appointmentId: z.string().uuid('Mã lịch hẹn không hợp lệ') });

// Xem trạng thái nhắc lịch của một lịch hẹn — cần quyền đọc lịch hẹn.
reminderRouter.get(
  '/appointment/:appointmentId',
  authorize('appointment:read'),
  asyncHandler(async (req, res) => {
    const { appointmentId } = apptParam.parse(req.params);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.listForAppointment(appointmentId));
  }),
);

/**
 * Kích hoạt điều phối nhắc lịch thủ công. Ở production việc này chạy tự động
 * qua cron/scheduler; endpoint này để admin chạy tay khi cần (kiểm thử, hoặc
 * gửi bù sau sự cố). Chỉ admin (audit:read là quyền admin có, dùng làm mốc).
 */
reminderRouter.post(
  '/dispatch',
  authorize('audit:read'),
  asyncHandler(async (req, res) => {
    const result = await service.dispatchDueReminders();
    await db.transaction().execute((trx) =>
      writeAuditLog(trx, {
        requestId: req.requestId,
        actorId: req.user!.sub,
        actorEmail: req.user!.email,
        action: 'REMINDER_DISPATCH_MANUAL',
        reason: `sent=${result.sent} failed=${result.failed} cancelled=${result.cancelled}`,
        ipAddress: req.ip,
      }),
    );
    res.json(result);
  }),
);
