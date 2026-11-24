export class AppError extends Error {
  constructor(
    override readonly message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super('Dữ liệu gửi lên không hợp lệ', 400, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Chưa xác thực') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Không đủ quyền truy cập') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Tài nguyên') {
    super(`${resource} không tồn tại`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super('Quá nhiều yêu cầu, vui lòng thử lại sau', 429, 'RATE_LIMITED');
  }
}

/**
 * Dữ liệu đã bị tiêu huỷ vĩnh viễn bằng crypto-shredding (huỷ DEK). 410 Gone
 * đúng ngữ nghĩa hơn 404 (chưa từng có) hay 500 (lỗi ngoài ý muốn) — tài
 * nguyên đã từng tồn tại và bị xoá CÓ CHỦ ĐÍCH, không quay lại được.
 */
export class DataDestroyedError extends AppError {
  constructor(message = 'Dữ liệu đã được huỷ vĩnh viễn theo chính sách lưu trữ') {
    super(message, 410, 'DATA_DESTROYED');
  }
}
