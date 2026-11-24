import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async-handler.js';
import { env } from '../../config/env.js';
import { UnauthorizedError } from '../../middleware/errors.js';
import * as service from './dklink.service.js';

// ── Webhook nhận bệnh nhân mới từ DK-link (KHÔNG đăng nhập; bảo vệ bằng secret) ──
// Router riêng để KHÔNG dính middleware authenticate của staff router. DK-link
// gửi `Authorization: Bearer <crm_webhook_secret>` (xem trigger notify_crm_new_patient).
export const dklinkWebhookRouter: Router = Router();

const webhookSchema = z.object({
  event: z.string(),
  patient: z
    .object({
      id: z.string().uuid(),
      full_name: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      date_of_birth: z.string().nullable().optional(),
    })
    .passthrough(),
});

dklinkWebhookRouter.post(
  '/patient',
  asyncHandler(async (req, res) => {
    if (env.DKLINK_WEBHOOK_SECRET) {
      const auth = req.header('authorization') ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== env.DKLINK_WEBHOOK_SECRET) throw new UnauthorizedError('Webhook không hợp lệ');
    }

    const body = webhookSchema.parse(req.body);
    if (body.event !== 'patient.created') {
      return res.json({ ok: true, ignored: body.event });
    }

    const result = await service.upsertPatientFromDkLink(body.patient, {
      requestId: req.requestId,
      ipAddress: req.ip,
    });
    res.json({ ok: true, ...result });
  }),
);
