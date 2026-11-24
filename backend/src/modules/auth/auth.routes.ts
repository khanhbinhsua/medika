import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { authenticate } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './auth.controller.js';

export const authRouter: Router = Router();

/** Chống brute-force: 5 lần thử / 15 phút / IP (HIPAA §164.308(a)(5)(ii)(C)). */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Quá nhiều lần đăng nhập, vui lòng thử lại sau 15 phút' } },
});

authRouter.post('/login', loginLimiter, asyncHandler(controller.login));
authRouter.post('/mfa/verify', loginLimiter, asyncHandler(controller.verifyMfa));
authRouter.post('/mfa/recovery', loginLimiter, asyncHandler(controller.verifyRecoveryCode));
authRouter.post('/mfa/enroll/start', loginLimiter, asyncHandler(controller.startEnrollment));
authRouter.post('/mfa/enroll/confirm', loginLimiter, asyncHandler(controller.confirmEnrollment));
authRouter.post('/refresh', asyncHandler(controller.refresh));

authRouter.post('/mfa/setup', authenticate, asyncHandler(controller.setupMfa));
authRouter.post('/mfa/confirm', authenticate, asyncHandler(controller.confirmMfa));
authRouter.post('/logout', authenticate, asyncHandler(controller.logout));
authRouter.get('/me', authenticate, asyncHandler(controller.me));
