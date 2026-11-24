import { Router } from 'express';
import type { Request, Response, CookieOptions } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env, isProduction } from '../../config/env.js';
import { authenticatePatient } from '../../middleware/authenticate-patient.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { UnauthorizedError } from '../../middleware/errors.js';
import { passwordSchema } from '../auth/auth.schemas.js';
import * as service from './portal.service.js';

export const portalRouter: Router = Router();

const REFRESH_COOKIE = 'crm_portal_refresh';

function cookieOptions(): CookieOptions {
  return { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/api/portal/auth', maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1000 };
}
function meta(req: Request): service.RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip, userAgent: req.get('user-agent') };
}
function sendAuth(res: Response, result: service.PortalAuthSuccess) {
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions());
  res.setHeader('Cache-Control', 'no-store');
  res.json({ accessToken: result.accessToken, expiresIn: result.expiresIn, mustChangePassword: result.mustChangePassword, patient: result.patient });
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Quá nhiều lần đăng nhập, vui lòng thử lại sau' } },
});

const loginSchema = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1) });
const changePwSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

// ── Auth ──────────────────────────────────────────────────────────────

portalRouter.post(
  '/auth/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    sendAuth(res, await service.login(email, password, meta(req)));
  }),
);

portalRouter.post(
  '/auth/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (typeof token !== 'string' || !token) throw new UnauthorizedError('Thiếu refresh token');
    sendAuth(res, await service.refresh(token, meta(req)));
  }),
);

portalRouter.post(
  '/auth/logout',
  authenticatePatient,
  asyncHandler(async (req, res) => {
    await service.logout(req.patient!.portalAccountId, meta(req));
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
    res.status(204).send();
  }),
);

portalRouter.post(
  '/auth/change-password',
  authenticatePatient,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePwSchema.parse(req.body);
    await service.changePassword(req.patient!.portalAccountId, currentPassword, newPassword, meta(req));
    res.status(204).send();
  }),
);

// ── Dữ liệu của chính bệnh nhân ──────────────────────────────────────

portalRouter.use(authenticatePatient);

portalRouter.get('/me', asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await service.getMe(req.patient!.patientId));
}));

portalRouter.get('/appointments', asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await service.getAppointments(req.patient!.patientId));
}));

portalRouter.get('/prescriptions', asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await service.getPrescriptions(req.patient!.patientId));
}));
