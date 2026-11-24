import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { ValidationError } from '../../middleware/errors.js';
import * as service from './document.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import { uploadDocumentMetaSchema, listDocumentsSchema, ALLOWED_MIME_TYPES } from './document.schemas.js';

const idParam = z.object({ documentId: z.string().uuid('Mã tài liệu không hợp lệ') });

function actor(req: Request): Actor {
  return { id: req.user!.sub, email: req.user!.email };
}

function meta(req: Request): RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip };
}

function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
}

/**
 * Nhận file vào bộ nhớ (không ghi tạm ra đĩa ở dạng chưa mã hoá) — kích thước
 * đã bị chặn ở `limits.fileSize` nên giữ trong RAM là chấp nhận được cho quy
 * mô phòng khám 20 người, không phải nền tảng chia sẻ file công cộng.
 */
export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.DOCUMENT_MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new ValidationError(`Định dạng file không được hỗ trợ: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
}).single('file');

/**
 * busboy (dùng bên trong multer) decode header `Content-Disposition: filename=`
 * theo Latin-1 mặc định (RFC 7578 truyền thống), bất kể client gửi UTF-8 thật
 * hay không — tên có dấu tiếng Việt sẽ vỡ (mojibake) nếu không chuyển lại.
 * Đây là workaround chuẩn cho vấn đề đã biết của busboy, không phải giả định.
 */
function fixMojibakeFilename(name: string): string {
  return Buffer.from(name, 'latin1').toString('utf8');
}

export async function upload(req: Request, res: Response) {
  if (!req.file) throw new ValidationError('Thiếu file đính kèm');

  const input = uploadDocumentMetaSchema.parse(req.body);
  const result = await service.uploadDocument(
    { patientId: input.patientId },
    {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: fixMojibakeFilename(req.file.originalname),
    },
    actor(req),
    meta(req),
  );
  noStore(res);
  res.status(201).json(result);
}

export async function list(req: Request, res: Response) {
  const { patientId } = listDocumentsSchema.parse(req.query);
  noStore(res);
  res.json(await service.listDocuments(patientId, actor(req), meta(req)));
}

export async function download(req: Request, res: Response) {
  const { documentId } = idParam.parse(req.params);
  const { buffer, fileName, mimeType } = await service.downloadDocument(documentId, actor(req), meta(req));

  noStore(res);
  res.setHeader('Content-Type', mimeType);
  // RFC 5987: filename* cho tên có ký tự ngoài ASCII (tiếng Việt có dấu),
  // filename (ASCII) làm phương án dự phòng cho trình duyệt cũ.
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  res.send(buffer);
}

export async function remove(req: Request, res: Response) {
  const { documentId } = idParam.parse(req.params);
  await service.softDeleteDocument(documentId, actor(req), meta(req));
  res.status(204).send();
}
