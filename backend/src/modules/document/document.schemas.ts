import { z } from 'zod';

/** multer đưa các trường form-data khác vào req.body dạng string thuần. */
export const uploadDocumentMetaSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
});

export const listDocumentsSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
});

/**
 * Chỉ nhận định dạng phù hợp hồ sơ y tế: PDF (kết quả scan), ảnh (X-quang,
 * ảnh chụp vết thương chụp lại), TIFF (ảnh y khoa độ phân giải cao). Không
 * nhận file thực thi hay định dạng có thể chứa script (SVG, HTML...).
 */
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
]);

export type UploadDocumentMeta = z.infer<typeof uploadDocumentMetaSchema>;
export type ListDocumentsQuery = z.infer<typeof listDocumentsSchema>;
