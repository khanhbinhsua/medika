import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env, type NotifyChannel } from '../config/env.js';
import { logger } from '../config/logger.js';

// ── Mô hình kênh thống nhất ────────────────────────────────────────────
//
// Mỗi kênh (Zalo / SMS / Email) cài đặt một ChannelProvider. Khác với bản
// cũ (ném lỗi khi thất bại), provider ở đây TRẢ VỀ kết quả ok/thất bại để
// tầng dịch vụ tự quyết định fallback sang kênh kế tiếp thay vì phải bắt
// exception. Lỗi ngoài dự kiến (bug, mạng) vẫn được bọc thành result.

export interface ChannelPayload {
  to: string; // SĐT (Zalo/SMS) hoặc email
  subject?: string | undefined; // chỉ email dùng
  body: string; // nội dung đã render (chứa PHI tối thiểu) — KHÔNG lưu lại
  zaloTemplateId?: string | undefined; // template ZNS đã duyệt (chỉ kênh Zalo)
  zaloTemplateData?: Record<string, string> | undefined; // biến điền vào template ZNS
}

export interface ChannelResult {
  ok: boolean;
  providerMessageId?: string | undefined;
  /** Mã lỗi NGẮN, KHÔNG chứa PHI — an toàn để ghi notification_logs. */
  error?: string | undefined;
}

export interface ChannelProvider {
  readonly channel: NotifyChannel;
  send(payload: ChannelPayload): Promise<ChannelResult>;
}

/** Che số điện thoại trong log — chỉ giữ 3 số cuối, không lộ PHI liên hệ. */
export function maskPhone(phone: string): string {
  return phone.length <= 3 ? '***' : `${'*'.repeat(phone.length - 3)}${phone.slice(-3)}`;
}

/** Bọc mọi throw thành ChannelResult để fallback không bao giờ vỡ vì exception. */
async function guard(fn: () => Promise<ChannelResult>): Promise<ChannelResult> {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : 'unknown_error' };
  }
}

// ── Email qua SMTP (dev: Mailhog, prod: SendGrid/BAA) ───────────────────

class SmtpEmailProvider implements ChannelProvider {
  readonly channel = 'email' as const;
  #transporter: Transporter | undefined;

  private transporter(): Transporter {
    if (this.#transporter) return this.#transporter;
    this.#transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
    });
    return this.#transporter;
  }

  send(payload: ChannelPayload): Promise<ChannelResult> {
    return guard(async () => {
      const info = await this.transporter().sendMail({
        from: `"${env.NOTIFY_FROM_NAME}" <${env.NOTIFY_FROM_EMAIL}>`,
        to: payload.to,
        subject: payload.subject ?? '(không tiêu đề)',
        text: payload.body,
      });
      return { ok: true, providerMessageId: info.messageId };
    });
  }
}

// ── Zalo ZNS (Zalo Notification Service) ────────────────────────────────

/** Dev: chỉ log, KHÔNG gọi Zalo thật. */
class MockZaloProvider implements ChannelProvider {
  readonly channel = 'zalo' as const;
  async send(payload: ChannelPayload): Promise<ChannelResult> {
    logger.info(
      { to: maskPhone(payload.to), template: payload.zaloTemplateId },
      '[Zalo dev] đã "gửi" ZNS (chỉ log, không gọi API thật)',
    );
    return { ok: true, providerMessageId: `mock-zalo-${Date.now()}` };
  }
}

/**
 * Zalo ZNS thật. ZNS gửi theo template đã duyệt với Zalo (template_id +
 * template_data), KHÔNG gửi văn bản tự do — Zalo kiểm duyệt nội dung trước.
 * Đáp: { error: 0, message, data: { msg_id } } khi thành công.
 */
class ZnsProvider implements ChannelProvider {
  readonly channel = 'zalo' as const;
  send(payload: ChannelPayload): Promise<ChannelResult> {
    return guard(async () => {
      if (!payload.zaloTemplateId) return { ok: false, error: 'missing_zns_template_id' };
      const res = await fetch(env.ZALO_ZNS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', access_token: env.ZALO_ACCESS_TOKEN ?? '' },
        body: JSON.stringify({
          phone: payload.to,
          template_id: payload.zaloTemplateId,
          template_data: payload.zaloTemplateData ?? {},
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: number; message?: string; data?: { msg_id?: string } };
      if (!res.ok) return { ok: false, error: `http_${res.status}` };
      // Zalo trả error=0 khi thành công; khác 0 là mã lỗi (KHÔNG chứa PHI).
      if (json.error !== 0) return { ok: false, error: `zns_${json.error ?? 'unknown'}` };
      return { ok: true, providerMessageId: json.data?.msg_id };
    });
  }
}

// ── SMS ─────────────────────────────────────────────────────────────────

/** Dev: chỉ ghi log, KHÔNG gửi thật — tránh vô tình nhắn tin ra số thật. */
class ConsoleSmsProvider implements ChannelProvider {
  readonly channel = 'sms' as const;
  async send(payload: ChannelPayload): Promise<ChannelResult> {
    logger.info(
      { to: maskPhone(payload.to), length: payload.body.length },
      '[SMS dev] đã "gửi" (chỉ log, không gửi thật)',
    );
    return { ok: true, providerMessageId: `console-sms-${Date.now()}` };
  }
}

/**
 * SMS Brandname qua eSMS.vn — nhà cung cấp phổ biến tại VN, gửi tin gắn tên
 * thương hiệu (brandname) đã đăng ký. SmsType=2 = brandname CSKH.
 * Đáp: { CodeResult: "100", SMSID, ... } — "100" là thành công.
 */
class EsmsProvider implements ChannelProvider {
  readonly channel = 'sms' as const;
  send(payload: ChannelPayload): Promise<ChannelResult> {
    return guard(async () => {
      const res = await fetch(env.ESMS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ApiKey: env.ESMS_API_KEY,
          SecretKey: env.ESMS_SECRET_KEY,
          Brandname: env.ESMS_BRANDNAME,
          Phone: payload.to,
          Content: payload.body,
          SmsType: '2',
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { CodeResult?: string; SMSID?: string };
      if (!res.ok) return { ok: false, error: `http_${res.status}` };
      if (json.CodeResult !== '100') return { ok: false, error: `esms_${json.CodeResult ?? 'unknown'}` };
      return { ok: true, providerMessageId: json.SMSID };
    });
  }
}

class TwilioSmsProvider implements ChannelProvider {
  readonly channel = 'sms' as const;
  async send(_payload: ChannelPayload): Promise<ChannelResult> {
    return { ok: false, error: 'twilio_not_implemented' };
  }
}

// ── Lựa chọn provider theo cấu hình ─────────────────────────────────────

const providers = new Map<NotifyChannel, ChannelProvider>();

function build(channel: NotifyChannel): ChannelProvider {
  switch (channel) {
    case 'zalo':
      return env.ZALO_PROVIDER === 'zns' ? new ZnsProvider() : new MockZaloProvider();
    case 'sms':
      if (env.SMS_PROVIDER === 'esms') return new EsmsProvider();
      if (env.SMS_PROVIDER === 'twilio') return new TwilioSmsProvider();
      return new ConsoleSmsProvider();
    case 'email':
      return new SmtpEmailProvider();
  }
}

export function getChannelProvider(channel: NotifyChannel): ChannelProvider {
  let p = providers.get(channel);
  if (!p) {
    p = build(channel);
    providers.set(channel, p);
  }
  return p;
}

/** Cho test: xoá cache provider để đổi cấu hình giữa các lần chạy. */
export function resetChannelProviders(): void {
  providers.clear();
}
