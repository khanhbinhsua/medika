import { z } from 'zod';

/** multer đưa các trường form-data (không phải file) vào req.body dạng string thuần. */
export const uploadPhotoMetaSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
  encounterId: z.string().uuid().optional(),
  category: z.enum(['before', 'after', 'progress']),
  bodyArea: z.string().trim().max(100).optional(),
  caption: z.string().trim().max(500).optional(),
  takenAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày chụp không hợp lệ (YYYY-MM-DD)')
    .optional(),
});

export const listPhotosSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
  encounterId: z.string().uuid().optional(),
});

/** Chỉ nhận ảnh raster an toàn — không SVG (có thể nhúng script). */
export const ALLOWED_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type UploadPhotoMeta = z.infer<typeof uploadPhotoMetaSchema>;
export type ListPhotosQuery = z.infer<typeof listPhotosSchema>;
