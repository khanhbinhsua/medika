import type { Transaction } from 'kysely';
import { db } from '../../db/index.js';
import type { Database, ReminderChannel } from '../../db/types.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { writeAuditLog } from '../../audit/audit-logger.js';
import { loadDek } from '../../crypto/dek-store.js';
import { decryptOptionalField, zeroize } from '../../crypto/field-encryption.js';
import { DataDestroyedError } from '../../middleware/errors.js';
import { getChannelProvider } from '../../notifications/providers.js';

type Db = typeof db | Transaction<Database>;

/**
 * Lập lịch nhắc cho một lịch hẹn — gọi từ trong transaction tạo lịch hẹn.
 * Chỉ tạo reminder cho kênh mà bệnh nhân THỰC SỰ có thông tin liên hệ (dùng
 * DEK đã mở sẵn ở caller, không mở lại). Tránh tạo reminder chắc chắn thất bại.
 */
export async function scheduleForAppointment(
  trx: Db,
  params: { appointmentId: string; patientId: string; scheduledStart: Date; dek: Buffer },
): Promise<void> {
  if (env.REMINDER_LEAD_HOURS <= 0) return;

  const scheduledFor = new Date(params.scheduledStart.getTime() - env.REMINDER_LEAD_HOURS * 3600_000);
  // Lịch hẹn quá gần (mốc nhắc đã ở quá khứ) thì không nhắc — tránh gửi ngay
  // một thông báo "nhắc trước 24h" cho cuộc hẹn còn 2 tiếng nữa.
  if (scheduledFor.getTime() <= Date.now()) return;

  const patient = await trx
    .selectFrom('patients')
    .select(['email_enc', 'phone_enc'])
    .where('id', '=', params.patientId)
    .executeTakeFirst();
  if (!patient) return;

  const hasEmail = !!decryptOptionalField(patient.email_enc, params.dek);
  const hasPhone = !!decryptOptionalField(patient.phone_enc, params.dek);

  const channels: ReminderChannel[] = [];
  if (hasEmail) channels.push('email');
  if (hasPhone) channels.push('sms');
  if (channels.length === 0) return;

  await trx
    .insertInto('appointment_reminders')
    .values(
      channels.map((channel) => ({
        appointment_id: params.appointmentId,
        channel,
        scheduled_for: scheduledFor,
      })),
    )
    .execute();
}

export interface ReminderDto {
  id: string;
  channel: ReminderChannel;
  scheduledFor: Date;
  status: string;
  sentAt: Date | null;
  attempts: number;
  failureReason: string | null;
}

/** Trạng thái nhắc lịch của một lịch hẹn — không chứa PHI (chỉ kênh/trạng thái/giờ). */
export async function listForAppointment(appointmentId: string): Promise<ReminderDto[]> {
  const rows = await db
    .selectFrom('appointment_reminders')
    .select(['id', 'channel', 'scheduled_for', 'status', 'sent_at', 'attempts', 'failure_reason'])
    .where('appointment_id', '=', appointmentId)
    .orderBy('scheduled_for', 'asc')
    .execute();

  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    scheduledFor: r.scheduled_for,
    status: r.status,
    sentAt: r.sent_at,
    attempts: r.attempts,
    failureReason: r.failure_reason,
  }));
}

export interface DispatchResult {
  processed: number;
  sent: number;
  failed: number;
  cancelled: number;
  retryLater: number;
}

/**
 * Gửi mọi reminder tới hạn. Chạy định kỳ (cron / EventBridge ở production, hoặc
 * `npm run reminders:dispatch` thủ công). Idempotent theo từng dòng: chỉ đụng
 * các reminder status='pending' và scheduled_for <= now.
 *
 * Nội dung nhắc CỐ TÌNH tối thiểu — chỉ ngày giờ + tên phòng khám, KHÔNG kèm
 * lý do khám, tên bác sĩ hay bất kỳ PHI lâm sàng nào: email/SMS là kênh không
 * mã hoá. Đây là disclosure TỚI CHÍNH bệnh nhân về lịch của họ, thuộc diện
 * loại trừ khỏi "accounting of disclosures" (§164.528), nên KHÔNG ghi
 * phi_access_log; nhưng vẫn ghi audit_log cho hành động hệ thống.
 */
export async function dispatchDueReminders(now = new Date()): Promise<DispatchResult> {
  const due = await db
    .selectFrom('appointment_reminders as r')
    .innerJoin('appointments as a', 'a.id', 'r.appointment_id')
    .innerJoin('patients as p', 'p.id', 'a.patient_id')
    .select([
      'r.id as reminder_id',
      'r.channel',
      'r.attempts',
      'a.id as appointment_id',
      'a.patient_id',
      'a.status as appointment_status',
      'a.scheduled_start',
      'a.room',
      'p.dek_id',
      'p.email_enc',
      'p.phone_enc',
      'p.purged_at',
      'p.deleted_at',
    ])
    .where('r.status', '=', 'pending')
    .where('r.scheduled_for', '<=', now)
    .orderBy('r.scheduled_for', 'asc')
    .limit(200)
    .execute();

  const result: DispatchResult = { processed: 0, sent: 0, failed: 0, cancelled: 0, retryLater: 0 };

  for (const row of due) {
    result.processed++;

    // Lịch hẹn đã huỷ/hoàn thành/không đến, hoặc bệnh nhân đã xoá/tiêu huỷ —
    // huỷ reminder, không gửi.
    const stale =
      row.appointment_status === 'cancelled' ||
      row.appointment_status === 'completed' ||
      row.appointment_status === 'no_show' ||
      row.deleted_at !== null ||
      row.purged_at !== null;

    if (stale) {
      await cancelReminder(row.reminder_id, 'appointment_no_longer_active');
      result.cancelled++;
      continue;
    }

    let recipient: string | null;
    try {
      const dek = await loadDek(db, row.dek_id);
      try {
        recipient =
          row.channel === 'email'
            ? decryptOptionalField(row.email_enc, dek)
            : decryptOptionalField(row.phone_enc, dek);
      } finally {
        zeroize(dek);
      }
    } catch (err) {
      // Khoá đã bị crypto-shred giữa chừng — không thể lấy liên hệ, huỷ reminder.
      if (err instanceof DataDestroyedError) {
        await cancelReminder(row.reminder_id, 'patient_data_destroyed');
        result.cancelled++;
        continue;
      }
      throw err;
    }

    if (!recipient) {
      await cancelReminder(row.reminder_id, 'no_contact_for_channel');
      result.cancelled++;
      continue;
    }

    const text = buildReminderText(row.scheduled_start, row.room);
    try {
      // Kênh reminder ('email' | 'sms') là kênh cố định của lịch hẹn, không
      // fallback ở đây — dùng đúng provider của kênh đó.
      const sent = await getChannelProvider(row.channel).send({
        to: recipient,
        subject: 'Nhắc lịch hẹn khám',
        body: text,
      });
      if (!sent.ok) throw new Error(sent.error ?? 'send_failed');
      await markSent(row.reminder_id, row.attempts + 1);
      await auditReminder(row.appointment_id, row.patient_id, row.channel, 'REMINDER_SENT');
      result.sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const reason = err instanceof Error ? err.message.slice(0, 200) : 'unknown_error';
      if (attempts >= env.REMINDER_MAX_ATTEMPTS) {
        await markFailed(row.reminder_id, attempts, reason);
        await auditReminder(row.appointment_id, row.patient_id, row.channel, 'REMINDER_FAILED');
        result.failed++;
      } else {
        await bumpAttempt(row.reminder_id, attempts);
        result.retryLater++;
      }
      logger.warn({ reminderId: row.reminder_id, attempts, reason }, 'Gửi nhắc lịch thất bại');
    }
  }

  if (result.processed > 0) {
    logger.info(result, 'Đã điều phối nhắc lịch');
  }
  return result;
}

// ── nội bộ ────────────────────────────────────────────────────────────

function buildReminderText(scheduledStart: Date, room: string | null): string {
  const when = scheduledStart.toLocaleString('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const roomLine = room ? ` tại ${room}` : '';
  return (
    `Kính chào,\n\n` +
    `Bạn có lịch hẹn khám vào ${when}${roomLine}.\n` +
    `Vui lòng đến trước giờ hẹn 15 phút. Nếu cần đổi lịch, xin liên hệ phòng khám.\n\n` +
    `Trân trọng,\n${env.NOTIFY_FROM_NAME}`
  );
}

async function markSent(reminderId: string, attempts: number) {
  await db
    .updateTable('appointment_reminders')
    .set({ status: 'sent', sent_at: new Date(), attempts, last_attempt_at: new Date() })
    .where('id', '=', reminderId)
    .execute();
}

async function markFailed(reminderId: string, attempts: number, reason: string) {
  await db
    .updateTable('appointment_reminders')
    .set({ status: 'failed', attempts, last_attempt_at: new Date(), failure_reason: reason })
    .where('id', '=', reminderId)
    .execute();
}

async function bumpAttempt(reminderId: string, attempts: number) {
  await db
    .updateTable('appointment_reminders')
    .set({ attempts, last_attempt_at: new Date() })
    .where('id', '=', reminderId)
    .execute();
}

async function cancelReminder(reminderId: string, reason: string) {
  await db
    .updateTable('appointment_reminders')
    .set({ status: 'cancelled', failure_reason: reason, last_attempt_at: new Date() })
    .where('id', '=', reminderId)
    .execute();
}

async function auditReminder(
  appointmentId: string,
  patientId: string,
  channel: ReminderChannel,
  action: string,
) {
  await db.transaction().execute((trx) =>
    writeAuditLog(trx, {
      actorEmail: 'system:reminder-dispatcher',
      action,
      entityType: 'appointment',
      entityId: appointmentId,
      changes: { channel: { old: null, new: channel }, patientId: { old: null, new: patientId } },
    }),
  );
}
