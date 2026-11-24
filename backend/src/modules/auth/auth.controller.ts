import type { Request, Response, CookieOptions } from 'express';
import { env, isProduction } from '../../config/env.js';
import { UnauthorizedError } from '../../middleware/errors.js';
import * as service from './auth.service.js';
import {
  loginSchema,
  mfaVerifySchema,
  mfaRecoverySchema,
  mfaConfirmSchema,
  enrollStartSchema,
  enrollConfirmSchema,
} from './auth.schemas.js';

const REFRESH_COOKIE = 'crm_refresh';

/**
 * Refresh token nằm trong cookie httpOnly nên JavaScript (và XSS) không đọc được.
 * Path giới hạn ở /api/auth để cookie không bị gửi kèm mọi request khác.
 */
function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
}

function meta(req: Request): service.RequestMeta {
  return {
    requestId: req.requestId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

function sendAuthSuccess(res: Response, result: service.AuthSuccess) {
  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
  // PHI-adjacent: không cho trình duyệt hay proxy cache phản hồi có token.
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    accessToken: result.accessToken,
    expiresIn: result.expiresIn,
    user: result.user,
  });
}

export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const result = await service.login(input, meta(req));

  res.setHeader('Cache-Control', 'no-store');

  if (result.kind === 'mfa_required') {
    res.json({ mfaRequired: true, mfaToken: result.mfaToken });
    return;
  }

  if (result.kind === 'mfa_enrollment_required') {
    res.json({ mfaEnrollmentRequired: true, enrollmentToken: result.enrollmentToken });
    return;
  }

  sendAuthSuccess(res, result);
}

export async function startEnrollment(req: Request, res: Response) {
  const { enrollmentToken } = enrollStartSchema.parse(req.body);
  const result = await service.startEnrollment(enrollmentToken, meta(req));
  res.setHeader('Cache-Control', 'no-store');
  res.json(result);
}

export async function confirmEnrollment(req: Request, res: Response) {
  const { enrollmentToken, code } = enrollConfirmSchema.parse(req.body);
  sendAuthSuccess(res, await service.confirmEnrollment(enrollmentToken, code, meta(req)));
}

export async function verifyMfa(req: Request, res: Response) {
  const input = mfaVerifySchema.parse(req.body);
  sendAuthSuccess(res, await service.verifyMfa(input, meta(req)));
}

export async function verifyRecoveryCode(req: Request, res: Response) {
  const input = mfaRecoverySchema.parse(req.body);
  sendAuthSuccess(res, await service.verifyRecoveryCode(input, meta(req)));
}

export async function setupMfa(req: Request, res: Response) {
  const user = req.user!;
  const result = await service.setupMfa(user.sub, user.email, meta(req));
  res.setHeader('Cache-Control', 'no-store');
  res.json(result);
}

export async function confirmMfa(req: Request, res: Response) {
  const { code } = mfaConfirmSchema.parse(req.body);
  const user = req.user!;
  await service.confirmMfa(user.sub, user.email, code, meta(req));
  res.status(204).send();
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (typeof token !== 'string' || token.length === 0) {
    throw new UnauthorizedError('Thiếu refresh token');
  }
  sendAuthSuccess(res, await service.refresh(token, meta(req)));
}

export async function logout(req: Request, res: Response) {
  const user = req.user!;
  await service.logout(user.sessionId, { id: user.sub, email: user.email }, meta(req));
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
  res.status(204).send();
}

export async function me(req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await service.getCurrentUser(req.user!.sub));
}
