import type { Transaction } from 'kysely';
import { db } from '../../db/index.js';
import type {
  Database,
  NotificationChannel,
  NotificationKind,
  NotificationStatus,
} from '../../db/types.js';
import { logger } from '../../config/logger.js';
import { notifyChannelOrder, type NotifyChannel } from '../../config/env.js';
import { loadDek } from '../../crypto/dek-store.js';
import { decryptField, decryptOptionalField, zeroize } from '../../crypto/field-encryption.js';
import { DataDestroyedError } from '../../middleware/errors.js';
import { getChannelProvider, type ChannelPayload } from '../../notifications/providers.js';

type Db = typeof db | Transaction<Database>;

// ── Render template ─────────────────────────────────────────────────────

/**
 * Thay {{ten_bien}} bằng giá trị trong vars. Biến thiếu → chuỗi rỗng (không
 * để lộ "{{...}}" thô trong tin nhắn gửi bệnh nhân). KHÔNG lồng/đệ quy —
 * giá trị thay vào không được diễn giải tiếp làm placeholder.
 */
export function renderTemplate(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
}

// ── Gửi thông báo đa kênh với fallback ──────────────────────────────────

export interface SendNotificationInput {
  patientId: string;
  kind: NotificationKind;
  /** Biến KHÔNG chứa PHI do caller cung cấp (giờ hẹn, tên phòng…). `ten`
   * (họ tên bệnh nhân) được service tự giải mã và thêm vào. */
  vars?: Record<string, string> | undefined;
  relatedType?: string | undefined;
  relatedId?: string | undefined;
  createdBy?: string | undefined;
  /** Ghi đè thứ tự kênh mặc định (NOTIFY_CHANNEL_ORDER). */
  channelOrder?: NotifyChannel[] | undefined;
}

export interface SendNotificationResult {
  id: string;
  status: NotificationStatus;
  channelSent: NotificationChannel | null;
}

interface Recipient {
  name: string;
  phone: string | null;
  email: string | null;
}

/** Giải mã liên hệ bệnh nhân. PHI chỉ tồn tại trong bộ nhớ, không rời hàm này. */
async function loadRecipient(database: Db, patientId: string): Promise<Recipient | null> {
  const p = await database
    .selectFrom('patients')
    .select(['first_name_enc', 'last_name_enc', 'phone_enc', 'email_enc', 'dek_id', 'purged_at'])
    .where('id', '=', patientId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!p || p.purged_at) return null;

  const dek = await loadDek(database, p.dek_id);
  try {
    const first = decryptField(p.first_name_enc, dek);
    const last = decryptField(p.last_name_enc, dek);
    return {
      name: `${last} ${first}`.trim(),
      phone: decryptOptionalField(p.phone_enc, dek),
      email: decryptOptionalField(p.email_enc, dek),
    };
  } finally {
    zeroize(dek);
  }
}

/** Địa chỉ nhận cho từng kênh. Zalo ZNS & SMS đều gửi theo SĐT. */
function recipientFor(channel: NotificationChannel, r: Recipient): string | null {
  return channel === 'email' ? r.email : r.phone;
}

async function logStep(
  database: Db,
  notificationId: string,
  channel: NotificationChannel,
  event: string,
  detail?: string,
): Promise<void> {
  await database
    .insertInto('notification_logs')
    .values({ notification_id: notificationId, channel, event, detail: detail ?? null })
    .execute();
}

/**
 * Gửi một thông báo tới bệnh nhân, thử lần lượt các kênh theo thứ tự cấu hình
 * (Zalo → SMS → Email) tới khi có kênh gửi được. Với mỗi kênh cần: (1) template
 * active cho (kind, channel), (2) bệnh nhân có địa chỉ nhận của kênh đó. Thiếu
 * cái nào thì bỏ qua kênh, sang kênh kế.
 *
 * QUAN TRỌNG về PHI: nội dung ĐÃ render (chứa tên bệnh nhân) KHÔNG bao giờ được
 * lưu vào DB — chỉ dựng lúc gửi rồi bỏ. Bảng notifications/notification_logs chỉ
 * giữ metadata (kênh, trạng thái, mã lỗi) không chứa PHI. Đây là disclosure TỚI
 * CHÍNH bệnh nhân nên không thuộc "accounting of disclosures" (§164.528).
 */
export async function sendNotification(input: SendNotificationInput): Promise<SendNotificationResult> {
  const order = input.channelOrder ?? notifyChannelOrder;

  const inserted = await db
    .insertInto('notifications')
    .values({
      patient_id: input.patientId,
      kind: input.kind,
      status: 'pending',
      related_type: input.relatedType ?? null,
      related_id: input.relatedId ?? null,
      created_by: input.createdBy ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const notificationId = inserted.id;

  let recipient: Recipient | null;
  try {
    recipient = await loadRecipient(db, input.patientId);
  } catch (err) {
    if (err instanceof DataDestroyedError) recipient = null;
    else throw err;
  }
  if (!recipient) {
    await db
      .updateTable('notifications')
      .set({ status: 'failed', last_error: 'no_recipient' })
      .where('id', '=', notificationId)
      .execute();
    return { id: notificationId, status: 'failed', channelSent: null };
  }

  // Template active cho kind này, gom theo kênh.
  const templates = await db
    .selectFrom('notification_templates')
    .select(['channel', 'subject', 'content', 'zalo_template_id'])
    .where('kind', '=', input.kind)
    .where('active', '=', true)
    .execute();
  const byChannel = new Map(templates.map((t) => [t.channel, t]));

  const vars: Record<string, string> = { ...(input.vars ?? {}), ten: recipient.name };

  let attempts = 0;
  let lastError = 'no_channel_available';

  for (const channel of order) {
    const tpl = byChannel.get(channel);
    if (!tpl) {
      await logStep(db, notificationId, channel, 'skip', 'no_template');
      continue;
    }
    const to = recipientFor(channel, recipient);
    if (!to) {
      await logStep(db, notificationId, channel, 'skip', 'no_contact');
      continue;
    }

    attempts++;
    await logStep(db, notificationId, channel, 'attempt');
    const payload: ChannelPayload = {
      to,
      subject: tpl.subject ?? undefined,
      body: renderTemplate(tpl.content, vars),
      zaloTemplateId: tpl.zalo_template_id ?? undefined,
      zaloTemplateData: channel === 'zalo' ? vars : undefined,
    };

    const result = await getChannelProvider(channel).send(payload);
    if (result.ok) {
      await db
        .updateTable('notifications')
        .set({
          status: 'sent',
          channel_sent: channel,
          provider_message_id: result.providerMessageId ?? null,
          sent_at: new Date(),
          attempts,
          last_error: null,
        })
        .where('id', '=', notificationId)
        .execute();
      await logStep(db, notificationId, channel, 'sent', result.providerMessageId ?? undefined);
      logger.info({ notificationId, channel, kind: input.kind }, 'Thông báo đã gửi (sau fallback)');
      return { id: notificationId, status: 'sent', channelSent: channel };
    }

    lastError = `${channel}:${result.error ?? 'failed'}`;
    await logStep(db, notificationId, channel, 'failed', result.error);
  }

  await db
    .updateTable('notifications')
    .set({ status: 'failed', attempts, last_error: lastError })
    .where('id', '=', notificationId)
    .execute();
  logger.warn({ notificationId, kind: input.kind, lastError }, 'Thông báo thất bại trên mọi kênh');
  return { id: notificationId, status: 'failed', channelSent: null };
}

// ── Quản lý template ────────────────────────────────────────────────────

export interface TemplateDto {
  id: string;
  code: string;
  name: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  subject: string | null;
  content: string;
  zaloTemplateId: string | null;
  active: boolean;
}

export async function listTemplates(): Promise<TemplateDto[]> {
  const rows = await db
    .selectFrom('notification_templates')
    .selectAll()
    .orderBy('kind', 'asc')
    .orderBy('channel', 'asc')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    channel: r.channel,
    subject: r.subject,
    content: r.content,
    zaloTemplateId: r.zalo_template_id,
    active: r.active,
  }));
}

export interface UpdateTemplateInput {
  name?: string | undefined;
  subject?: string | null | undefined;
  content?: string | undefined;
  zaloTemplateId?: string | null | undefined;
  active?: boolean | undefined;
}

/** Cập nhật nội dung/trạng thái một template. Trả về null nếu không tồn tại. */
export async function updateTemplate(id: string, input: UpdateTemplateInput): Promise<TemplateDto | null> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.subject !== undefined) patch.subject = input.subject;
  if (input.content !== undefined) patch.content = input.content;
  if (input.zaloTemplateId !== undefined) patch.zalo_template_id = input.zaloTemplateId;
  if (input.active !== undefined) patch.active = input.active;
  if (Object.keys(patch).length === 0) patch.updated_at = new Date();

  const updated = await db
    .updateTable('notification_templates')
    .set(patch)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
  if (!updated) return null;
  return {
    id: updated.id,
    code: updated.code,
    name: updated.name,
    kind: updated.kind,
    channel: updated.channel,
    subject: updated.subject,
    content: updated.content,
    zaloTemplateId: updated.zalo_template_id,
    active: updated.active,
  };
}

// ── Truy vấn / trạng thái ───────────────────────────────────────────────

export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  status: NotificationStatus;
  channelSent: NotificationChannel | null;
  scheduledAt: Date;
  sentAt: Date | null;
  readAt: Date | null;
  attempts: number;
  lastError: string | null;
}

/** Lịch sử thông báo của một bệnh nhân — metadata, KHÔNG chứa nội dung/PHI. */
export async function listForPatient(patientId: string, limit = 50): Promise<NotificationDto[]> {
  const rows = await db
    .selectFrom('notifications')
    .select([
      'id',
      'kind',
      'status',
      'channel_sent',
      'scheduled_at',
      'sent_at',
      'read_at',
      'attempts',
      'last_error',
    ])
    .where('patient_id', '=', patientId)
    .orderBy('created_at', 'desc')
    .limit(Math.min(limit, 200))
    .execute();

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    channelSent: r.channel_sent,
    scheduledAt: r.scheduled_at,
    sentAt: r.sent_at,
    readAt: r.read_at,
    attempts: r.attempts,
    lastError: r.last_error,
  }));
}

/**
 * Đánh dấu đã đọc — gọi từ webhook Zalo (user_seen_message / delivery receipt).
 * Chỉ nâng 'sent' → 'read'; không hạ cấp trạng thái khác. Idempotent.
 */
export async function markRead(providerMessageId: string): Promise<boolean> {
  const row = await db
    .selectFrom('notifications')
    .select(['id', 'status'])
    .where('provider_message_id', '=', providerMessageId)
    .executeTakeFirst();
  if (!row || row.status !== 'sent') return false;

  await db
    .updateTable('notifications')
    .set({ status: 'read', read_at: new Date() })
    .where('id', '=', row.id)
    .execute();
  await logStep(db, row.id, 'zalo', 'read');
  return true;
}
