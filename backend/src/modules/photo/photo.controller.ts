import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { ValidationError } from '../../middleware/errors.js';
import * as service from './photo.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import { uploadPhotoMetaSchema, listPhotosSchema, ALLOWED_PHOTO_MIME_TYPES } from './photo.schemas.js';

const idParam = z.object({ photoId: z.string().uuid('Mã ảnh không hợp lệ') });

function actor(req: Request): Actor {
  return { id: req.user!.sub, email: req.user!.email };
}
function meta(req: Request): RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip };
}
function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
}

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.DOCUMENT_MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_PHOTO_MIME_TYPES.has(file.mimetype)) {
      cb(new ValidationError(`Định dạng ảnh không được hỗ trợ: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
}).single('file');

export async function upload(req: Request, res: Response) {
  if (!req.file) throw new ValidationError('Thiếu ảnh đính kèm');
  const input = uploadPhotoMetaSchema.parse(req.body);
  const result = await service.uploadPhoto(
    input,
    { buffer: req.file.buffer, mimeType: req.file.mimetype },
    actor(req),
    meta(req),
  );
  noStore(res);
  res.status(201).json(result);
}

export async function list(req: Request, res: Response) {
  const query = listPhotosSchema.parse(req.query);
  noStore(res);
  res.json(
    await service.listPhotos(
      { patientId: query.patientId, ...(query.encounterId ? { encounterId: query.encounterId } : {}) },
      actor(req),
      meta(req),
    ),
  );
}

export async function image(req: Request, res: Response) {
  const { photoId } = idParam.parse(req.params);
  const { buffer, mimeType } = await service.getPhotoImage(photoId, actor(req), meta(req));
  noStore(res);
  res.setHeader('Content-Type', mimeType);
  res.send(buffer);
}

export async function remove(req: Request, res: Response) {
  const { photoId } = idParam.parse(req.params);
  await service.softDeletePhoto(photoId, actor(req), meta(req));
  res.status(204).send();
}
