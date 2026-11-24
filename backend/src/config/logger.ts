import pino from 'pino';
import stdSerializers from 'pino-std-serializers';
import { env, isProduction } from './env.js';

/**
 * Danh sách bắt buộc: những trường này KHÔNG BAO GIỜ được xuất hiện trong log.
 * Vi phạm = lộ PHI = vi phạm HIPAA §164.502.
 *
 * `req.body` bị chặn NGUYÊN KHỐI thay vì liệt kê từng trường con — một danh
 * sách liệt kê (whitelist ngược) luôn có nguy cơ bỏ sót trường mới thêm sau
 * này (đã xảy ra thật: `icd10Code`, `medication`, `code`, `recoveryCode` từng
 * không nằm trong danh sách cũ). Với dữ liệu y tế, mặc định phải là "giấu",
 * không phải "chỉ giấu những gì đã nghĩ tới". Các luồng nghiệp vụ cần ghi vết
 * (writeAuditLog, writePhiAccessLog) đã tự kiểm soát riêng, chỉ ghi tên
 * trường/cờ boolean, không bao giờ ghi giá trị — không phụ thuộc vào rule này.
 */
const PHI_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body',
  'res.headers["set-cookie"]',
  'patient',
  'patients',
  'medicalRecord',
  'prescription',
  'labResult',
  '*.firstName',
  '*.lastName',
  '*.dob',
  '*.ssn',
];

/**
 * Cắt query string khỏi req.url trước khi log.
 *
 * pino-http mặc định log NGUYÊN VẸN chuỗi URL, kể cả query string —
 * `GET /api/patients?q=Nguyen+Van+A` thì `q=Nguyen+Van+A` (tên bệnh nhân thật)
 * lọt thẳng vào access log của mọi request tìm kiếm. Đây KHÔNG sửa được bằng
 * `redact.paths: ['req.query']` như với req.body: serializer mặc định không
 * tách query thành key riêng, toàn bộ nằm chung trong chuỗi `url` — pino chỉ
 * redact theo path tới một KEY, không cắt được một phần của chuỗi.
 */
export function requestSerializer(req: Parameters<typeof stdSerializers.req>[0]) {
  const serialized = stdSerializers.req(req);
  const queryStart = serialized.url.indexOf('?');
  if (queryStart !== -1) {
    serialized.url = serialized.url.slice(0, queryStart);
  }
  return serialized;
}

const baseOptions: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths: PHI_REDACT_PATHS,
    censor: '[REDACTED]',
  },
  serializers: { req: requestSerializer },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

/**
 * pino-pretty là devDependency — image production (`npm ci --omit=dev`) không
 * có nó. pino ném lỗi NGAY khi khởi tạo nếu không nạp được transport target,
 * nên thử bọc trong try/catch và rơi về log JSON thuần khi module vắng mặt.
 * Trước đây bật pretty mọi lúc "không phải production" khiến container chạy
 * NODE_ENV=development trên image slim bị crash lúc khởi động.
 */
function createLogger(): pino.Logger {
  if (!isProduction) {
    try {
      return pino({
        ...baseOptions,
        transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
      });
    } catch {
      // pino-pretty không có (image production) — dùng JSON thuần.
    }
  }
  return pino(baseOptions);
}

export const logger = createLogger();
