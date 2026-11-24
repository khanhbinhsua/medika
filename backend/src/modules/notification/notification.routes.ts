import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { writeAuditLog } from '../../audit/audit-logger.js';
import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { UnauthorizedError, NotFoundError } from '../../middleware/errors.js';
import * as service from './notification.service.js';

const KINDS = [
  'appointment_reminder',
  'appointment_confirm',
  'appointment_cancel',
  'rebooking_reminder',
  'treatment_next',
  'survey',
  'marketing',
  'custom',
] as const;

// ── Webhook nhận biên nhận đã đọc (KHÔNG cần đăng nhập; bảo vệ bằng secret) ──
// Tách router riêng để KHÔNG dính middleware authenticate của staff router.
export const notificationWebhookRouter: Router = Router();

const webhookBody = z.object({
  // Zalo gửi nhiều trường; ta chỉ cần map msg_id → notification để đánh dấu đọc.
  message_id: z.string().min(1).optional(),
  msg_id: z.string().min(1).optional(),
});

notificationWebhookRouter.post(
  '/zalo',
  asyncHandler(async (req, res) => {
    // Bảo vệ webhook: khớp bí mật chia sẻ. Production luôn yêu cầu (env guard);
    // dev bỏ trống secret → mở để test cục bộ.
    if (env.NOTIFY_WEBHOOK_SECRET) {
      const auth = req.header('authorization') ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== env.NOTIFY_WEBHOOK_SECRET) throw new UnauthorizedError('Webhook không hợp lệ');
    }
    const body = webhookBody.parse(req.body);
    const providerMessageId = body.message_id ?? body.msg_id;
    const updated = providerMessageId ? await service.markRead(providerMessageId) : false;
    res.json({ ok: true, updated });
  }),
);

// ── Router quản lý (staff, cần quyền notification:manage) ────────────────
export const notificationRouter: Router = Router();

notificationRouter.use(authenticate);

// Danh sách template.
notificationRouter.get(
  '/templates',
  authorize('notification:manage'),
  asyncHandler(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.listTemplates());
  }),
);

const updateTemplateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().max(300).nullable().optional(),
  content: z.string().min(1).max(2000).optional(),
  zaloTemplateId: z.string().max(100).nullable().optional(),
  active: z.boolean().optional(),
});

// Cập nhật template (sửa nội dung, bật/tắt, gắn zalo_template_id đã duyệt).
notificationRouter.patch(
  '/templates/:id',
  authorize('notification:manage'),
  asyncHandler(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = updateTemplateBody.parse(req.body);
    const updated = await service.updateTemplate(id, input);
    if (!updated) throw new NotFoundError('Template');
    await db.transaction().execute((trx) =>
      writeAuditLog(trx, {
        requestId: req.requestId,
        actorId: req.user!.sub,
        actorEmail: req.user!.email,
        action: 'NOTIFICATION_TEMPLATE_UPDATE',
        entityType: 'notification_template',
        entityId: id,
        reason: `code=${updated.code}`,
        ipAddress: req.ip,
      }),
    );
    res.json(updated);
  }),
);

const sendBody = z.object({
  patientId: z.string().uuid(),
  kind: z.enum(KINDS),
  // Biến KHÔNG chứa PHI (giờ hẹn, phòng…). `ten` do server tự thêm.
  vars: z.record(z.string(), z.string()).optional(),
  relatedType: z.string().max(50).optional(),
  relatedId: z.string().uuid().optional(),
});

// Gửi thông báo thủ công (đa kênh, fallback). Ghi audit hành động hệ thống.
notificationRouter.post(
  '/send',
  authorize('notification:manage'),
  asyncHandler(async (req, res) => {
    const input = sendBody.parse(req.body);
    const result = await service.sendNotification({
      patientId: input.patientId,
      kind: input.kind,
      vars: input.vars,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      createdBy: req.user!.sub,
    });
    await db.transaction().execute((trx) =>
      writeAuditLog(trx, {
        requestId: req.requestId,
        actorId: req.user!.sub,
        actorEmail: req.user!.email,
        action: 'NOTIFICATION_SEND_MANUAL',
        entityType: 'patient',
        entityId: input.patientId,
        reason: `kind=${input.kind} status=${result.status} channel=${result.channelSent ?? '-'}`,
        ipAddress: req.ip,
      }),
    );
    res.status(result.status === 'failed' ? 502 : 200).json(result);
  }),
);

// Lịch sử thông báo của một bệnh nhân (metadata, không PHI).
notificationRouter.get(
  '/patient/:patientId',
  authorize('notification:manage'),
  asyncHandler(async (req, res) => {
    const { patientId } = z.object({ patientId: z.string().uuid() }).parse(req.params);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.listForPatient(patientId));
  }),
);
