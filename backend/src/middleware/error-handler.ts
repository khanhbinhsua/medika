import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError, NotFoundError } from './errors.js';

const MULTER_MESSAGES: Record<string, string> = {
  LIMIT_FILE_SIZE: `File vượt quá kích thước cho phép (tối đa ${env.DOCUMENT_MAX_SIZE_MB}MB)`,
  LIMIT_UNEXPECTED_FILE: 'Trường file không đúng như API mong đợi',
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Endpoint'));
};

/**
 * Chuẩn hoá mọi lỗi thành JSON. Không bao giờ trả stack trace hay thông điệp
 * lỗi thô của DB ra client — chúng có thể chứa PHI hoặc chi tiết schema.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.requestId;

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Dữ liệu gửi lên không hợp lệ', requestId },
    });
    return;
  }

  if (err instanceof MulterError) {
    res.status(400).json({
      error: { code: err.code, message: MULTER_MESSAGES[err.code] ?? err.message, requestId },
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId }, err.message);
    } else {
      logger.warn({ code: err.code, requestId, path: req.path }, err.message);
    }
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, requestId },
    });
    return;
  }

  logger.error({ err, requestId, path: req.path }, 'Lỗi không xử lý được');
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi hệ thống', requestId },
  });
};
