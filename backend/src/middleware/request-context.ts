import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { AccessTokenPayload } from '../modules/auth/token.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      user?: AccessTokenPayload;
    }
  }
}

export const requestContext: RequestHandler = (req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};
