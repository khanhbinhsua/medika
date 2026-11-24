import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

/**
 * Token bệnh nhân dùng AUDIENCE riêng ('crm-dk-portal'). Nhờ đó token bệnh
 * nhân KHÔNG BAO GIỜ verify được ở endpoint nhân viên (verifyAccessToken yêu
 * cầu audience 'crm-dk-api') và ngược lại — cách ly hoàn toàn hai thế giới.
 */
export interface PortalTokenPayload {
  sub: string; // portal_account_id
  patientId: string;
  purpose: 'portal';
}

const ISSUER = 'crm-dk';
const PORTAL_AUDIENCE = 'crm-dk-portal';
const ALGORITHMS: jwt.Algorithm[] = ['HS256'];

export function signPortalAccessToken(payload: { portalAccountId: string; patientId: string }): string {
  return jwt.sign(
    { sub: payload.portalAccountId, patientId: payload.patientId, purpose: 'portal' } satisfies PortalTokenPayload,
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_TTL_SECONDS, issuer: ISSUER, audience: PORTAL_AUDIENCE, algorithm: 'HS256' },
  );
}

export function verifyPortalAccessToken(token: string): PortalTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: ISSUER,
    audience: PORTAL_AUDIENCE,
    algorithms: ALGORITHMS,
  });
  if (typeof decoded === 'string' || decoded.purpose !== 'portal' || !decoded.patientId) {
    throw new jwt.JsonWebTokenError('Token cổng bệnh nhân không hợp lệ');
  }
  return decoded as unknown as PortalTokenPayload;
}
