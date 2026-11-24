import 'dotenv/config';
import { z } from 'zod';

// z.coerce.boolean() dùng Boolean(), nên chuỗi "false" thành true. Phải tự parse.
const boolFromEnv = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_SSL: boolFromEnv(false),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  SESSION_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(1800),

  /**
   * Giới hạn tần suất chung cho toàn bộ API, tính theo IP.
   *
   * Mặc định 300 request/15 phút phù hợp với phòng khám 20 người dùng thật.
   * Có thể nâng lên ở môi trường dev để chạy trọn bộ smoke test trong một lượt —
   * máy dev tự gọi API của chính nó không nằm trong mô hình đe doạ mà giới hạn
   * này sinh ra để chặn. Giá trị production phải giữ nguyên mặc định.
   */
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  /**
   * Chống brute-force cho /auth/login, /mfa/verify, /mfa/recovery, /mfa/enroll/*.
   * Mặc định 5 lần/15 phút là ngưỡng HIPAA §164.308(a)(5)(ii)(C) khuyến nghị cho
   * production. Nới ra ở dev vì một máy dev gọi lại API của chính mình nhiều
   * lần (script test, thử tay) không nằm trong mô hình đe doạ brute-force mà
   * giới hạn này nhắm tới.
   */
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),

  /**
   * Id dòng đầu tiên thuộc chuỗi nhật ký chính thức. Mặc định 0 = kiểm tra từ đầu.
   *
   * Chỉ đặt khác 0 khi có lý do vận hành ghi thành văn bản — ví dụ đã lưu trữ
   * và cắt bớt nhật ký cũ, hoặc dữ liệu trước đó là dữ liệu thử nghiệm. Kết quả
   * kiểm tra LUÔN báo kèm mốc này và số dòng nằm ngoài phạm vi kiểm tra, để
   * không ai dùng nó làm cách che giấu giả mạo.
   */
  AUDIT_CHAIN_BASELINE_ID: z.coerce.number().int().min(0).default(0),

  /**
   * Thời gian ân hạn tối thiểu (giờ) giữa lúc xoá (soft-delete) và lúc được
   * phép tiêu huỷ vĩnh viễn (crypto-shredding). Đây là lưới an toàn cuối cùng
   * cho một hành động không thể hoàn tác — chặn cả sai sót (xoá rồi tiêu huỷ
   * ngay trong lúc vội) lẫn một tài khoản admin bị chiếm quyền dùng để xoá dấu
   * vết PHI thật nhanh. 72 giờ đủ dài để phát hiện bất thường qua nhật ký kiểm
   * toán, đủ ngắn để không cản trở nhu cầu tuân thủ hợp pháp.
   */
  PATIENT_PURGE_GRACE_HOURS: z.coerce.number().int().min(0).default(72),

  /**
   * Nơi lưu ciphertext tài liệu y tế (documents.storage_key). Dev: thư mục
   * cục bộ (đã có trong .gitignore/uploads). Production: S3 — xem
   * src/storage/storage-provider.ts để biết điểm nối thêm ở Phase 5.
   */
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_PREFIX: z.string().default('documents/'),
  // Endpoint tuỳ chỉnh cho S3-compatible (MinIO tự host trên VPS). Bỏ trống = AWS S3.
  STORAGE_S3_ENDPOINT: z.string().url().optional(),
  STORAGE_S3_REGION: z.string().default('us-east-1'),
  STORAGE_S3_FORCE_PATH_STYLE: boolFromEnv(false),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  DOCUMENT_MAX_SIZE_MB: z.coerce.number().int().positive().default(20),

  // KEK provider: 'local' (chỉ dev), 'aws-kms' (AWS), 'vault' (HashiCorp Vault
  // tự host — phương án cho VPS không có KMS, khoá gốc không rời Vault).
  KEK_PROVIDER: z.enum(['local', 'aws-kms', 'vault']).default('local'),
  KEK_LOCAL_KEY: z.string().min(44).optional(),
  KEK_AWS_KMS_ARN: z.string().optional(),
  VAULT_ADDR: z.string().url().optional(),
  VAULT_TOKEN: z.string().optional(),
  // AppRole (khuyến nghị production): app đăng nhập lấy token ngắn hạn thay vì
  // giữ token quyền cao tĩnh. Nếu có cả hai, ưu tiên AppRole hơn VAULT_TOKEN.
  VAULT_ROLE_ID: z.string().optional(),
  VAULT_SECRET_ID: z.string().optional(),
  VAULT_TRANSIT_KEY: z.string().default('crm-dk-kek'),
  SEARCH_HMAC_KEY: z.string().min(44),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  MAX_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  ACCOUNT_LOCK_MINUTES: z.coerce.number().int().positive().default(15),

  MFA_ISSUER: z.string().default('CRM Y Te'),
  MFA_REQUIRED: boolFromEnv(true),

  // ── Thông báo / nhắc lịch ──────────────────────────────────────────
  // Dev: SMTP tới Mailhog (bắt mọi email, không gửi ra ngoài thật).
  // Production: SendGrid SMTP hoặc dịch vụ đã ký BAA.
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: boolFromEnv(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  NOTIFY_FROM_EMAIL: z.string().email().default('no-reply@crm-dk.local'),
  NOTIFY_FROM_NAME: z.string().default('Phòng khám CRM Y Tế'),

  // Dev: 'console' — SMS in ra log, không gửi thật. 'esms' — SMS Brandname qua
  // eSMS.vn (thị trường VN). Production quốc tế: 'twilio' (BAA).
  SMS_PROVIDER: z.enum(['console', 'esms', 'twilio']).default('console'),
  // eSMS.vn SMS Brandname REST API. Bỏ trống ở dev → tự rơi về console.
  ESMS_ENDPOINT: z
    .string()
    .url()
    .default('https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/'),
  ESMS_API_KEY: z.string().optional(),
  ESMS_SECRET_KEY: z.string().optional(),
  ESMS_BRANDNAME: z.string().default('CRMYTE'),

  // ── Zalo ZNS (Zalo Notification Service) ──────────────────────────────
  // Kênh thông báo ưu tiên tại VN. 'mock' (dev, chỉ log) | 'zns' (thật).
  ZALO_PROVIDER: z.enum(['mock', 'zns']).default('mock'),
  ZALO_ZNS_ENDPOINT: z.string().url().default('https://business.openapi.zalo.me/message/template'),
  ZALO_ACCESS_TOKEN: z.string().optional(),

  // Thứ tự fallback đa kênh: thử lần lượt tới khi có kênh gửi được.
  // Zalo (miễn phí/rẻ, tương tác cao) → SMS (chắc chắn tới) → Email (dự phòng).
  NOTIFY_CHANNEL_ORDER: z.string().default('zalo,sms,email'),

  // Bí mật chia sẻ bảo vệ webhook nhận biên nhận đã đọc (Zalo gọi vào). Đặt
  // trùng giá trị cấu hình phía trước webhook (proxy/Zalo). Bỏ trống ở dev →
  // webhook mở (chỉ chuyển sent→read, không lộ PHI); production BẮT BUỘC đặt.
  NOTIFY_WEBHOOK_SECRET: z.string().optional(),

  // Bí mật chia sẻ bảo vệ webhook nhận bệnh nhân mới từ DK-link. Phải TRÙNG
  // với integration_settings.crm_webhook_secret bên DK-link (nó gửi
  // `Authorization: Bearer <secret>`). Bỏ trống ở dev → webhook mở để test;
  // production BẮT BUỘC đặt.
  DKLINK_WEBHOOK_SECRET: z.string().optional(),

  // Gốc URL công khai để dựng link khảo sát gửi cho bệnh nhân (frontend).
  SURVEY_PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),

  // Mỗi lịch hẹn tạo một reminder gửi trước X giờ. 0 = tắt tạo tự động.
  REMINDER_LEAD_HOURS: z.coerce.number().int().min(0).default(24),
  // Số lần thử lại tối đa cho một reminder gửi thất bại.
  REMINDER_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Cấu hình môi trường không hợp lệ:\n${issues}`);
}

export const env = parsed.data;

if (env.KEK_PROVIDER === 'local' && !env.KEK_LOCAL_KEY) {
  throw new Error('KEK_PROVIDER=local yêu cầu KEK_LOCAL_KEY');
}
if (env.KEK_PROVIDER === 'aws-kms' && !env.KEK_AWS_KMS_ARN) {
  throw new Error('KEK_PROVIDER=aws-kms yêu cầu KEK_AWS_KMS_ARN');
}
if (env.KEK_PROVIDER === 'vault') {
  const hasAppRole = env.VAULT_ROLE_ID && env.VAULT_SECRET_ID;
  const hasToken = !!env.VAULT_TOKEN;
  if (!env.VAULT_ADDR || (!hasAppRole && !hasToken)) {
    throw new Error('KEK_PROVIDER=vault yêu cầu VAULT_ADDR và (VAULT_ROLE_ID+VAULT_SECRET_ID hoặc VAULT_TOKEN)');
  }
}
if (env.NODE_ENV === 'production' && env.KEK_PROVIDER === 'local') {
  // Production BẮT BUỘC khoá gốc ở HSM/dịch vụ quản lý khoá tách biệt — AWS KMS
  // (cloud) HOẶC HashiCorp Vault Transit (tự host trên VPS). Cả hai đều giữ
  // khoá gốc không rời khỏi dịch vụ. Chỉ 'local' (khoá cạnh dữ liệu) bị chặn.
  throw new Error(
    'Production không được dùng KEK_PROVIDER=local — bắt buộc aws-kms hoặc vault (HIPAA §164.312(a)(2)(iv))',
  );
}

// Không chặn cứng như KEK: ciphertext lưu local vẫn an toàn về mặt mã hoá
// (vô nghĩa nếu không có KEK), khác KEK sai chỗ là lộ khoá thật. Nhưng lưu
// local trên một container/EC2 không bền vững (mất khi restart, không có
// redundancy) — đây là vấn đề vận hành, cảnh báo thay vì chặn cứng.
if (env.NODE_ENV === 'production' && env.STORAGE_PROVIDER === 'local') {
  // console thay vì logger: logger.ts import từ env.ts, dùng ngược lại ở đây sẽ tạo circular import.
  console.warn(
    '[CẢNH BÁO] Production đang dùng STORAGE_PROVIDER=local — tài liệu sẽ mất khi container khởi động lại. Khuyến nghị chuyển sang S3.',
  );
}
if (env.STORAGE_PROVIDER === 's3' && !env.STORAGE_S3_BUCKET) {
  throw new Error('STORAGE_PROVIDER=s3 yêu cầu STORAGE_S3_BUCKET');
}

if (env.ZALO_PROVIDER === 'zns' && !env.ZALO_ACCESS_TOKEN) {
  throw new Error('ZALO_PROVIDER=zns yêu cầu ZALO_ACCESS_TOKEN');
}
if (env.SMS_PROVIDER === 'esms' && (!env.ESMS_API_KEY || !env.ESMS_SECRET_KEY)) {
  throw new Error('SMS_PROVIDER=esms yêu cầu ESMS_API_KEY và ESMS_SECRET_KEY');
}
if (env.NODE_ENV === 'production' && !env.NOTIFY_WEBHOOK_SECRET) {
  throw new Error('Production yêu cầu NOTIFY_WEBHOOK_SECRET để bảo vệ webhook biên nhận');
}
if (env.NODE_ENV === 'production' && !env.DKLINK_WEBHOOK_SECRET) {
  throw new Error('Production yêu cầu DKLINK_WEBHOOK_SECRET để bảo vệ webhook bệnh nhân từ DK-link');
}

// Thứ tự kênh fallback đã kiểm tra hợp lệ (chỉ zalo/sms/email, không rỗng).
const validChannels = ['zalo', 'sms', 'email'] as const;
export type NotifyChannel = (typeof validChannels)[number];
export const notifyChannelOrder: NotifyChannel[] = env.NOTIFY_CHANNEL_ORDER.split(',')
  .map((c) => c.trim())
  .filter((c): c is NotifyChannel => (validChannels as readonly string[]).includes(c));
if (notifyChannelOrder.length === 0) {
  throw new Error(`NOTIFY_CHANNEL_ORDER không hợp lệ: "${env.NOTIFY_CHANNEL_ORDER}" (chỉ chấp nhận zalo,sms,email)`);
}

export const corsOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim());
export const isProduction = env.NODE_ENV === 'production';
