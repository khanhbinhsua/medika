import type { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Express 4 không bắt promise rejection trong handler — nếu quên wrapper thì
 * lỗi async sẽ treo request thay vì đi tới errorHandler. Mọi route async
 * phải đi qua hàm này.
 */
export function asyncHandler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
