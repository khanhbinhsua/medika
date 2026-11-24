import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  permissions: string[];
  sessionId: string;
}

export interface MfaChallengePayload {
  sub: string;
  purpose: 'mfa';
}

export interface MfaEnrollmentPayload {
  sub: string;
  purpose: 'mfa_enroll';
}

const ISSUER = 'crm-dk';
const AUDIENCE = 'crm-dk-api';

// Ghim thuật toán tường minh thay vì dựa vào suy luận ngầm định của thư viện
// (jsonwebtoken chỉ giới hạn về họ HMAC khi secret là chuỗi thường — hành vi
// đó có thể đổi giữa các phiên bản). Ghim cứng chặn luôn kiểu tấn công đổi
// alg sang 'none' hoặc RS256/HS256 confusion.
const ALGORITHMS: jwt.Algorithm[] = ['HS256'];

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ALGORITHMS,
  });
  if (typeof decoded === 'string' || !('sessionId' in decoded)) {
    throw new jwt.JsonWebTokenError('Payload token không hợp lệ');
  }
  return decoded as unknown as AccessTokenPayload;
}

/** Token trung gian giữa bước mật khẩu và bước TOTP. Sống 5 phút, không cấp quyền gì. */
export function signMfaChallengeToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: 'mfa' } satisfies MfaChallengePayload, env.JWT_ACCESS_SECRET, {
    expiresIn: 300,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: 'HS256',
  });
}

export function verifyMfaChallengeToken(token: string): string {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER, audience: AUDIENCE, algorithms: ALGORITHMS });
  if (typeof decoded === 'string' || decoded.purpose !== 'mfa' || !decoded.sub) {
    throw new jwt.JsonWebTokenError('Token MFA không hợp lệ');
  }
  return decoded.sub;
}

/**
 * Token cho phép người dùng đã xác thực mật khẩu nhưng CHƯA có MFA được
 * đăng ký TOTP. Không cấp quyền truy cập dữ liệu — chỉ dùng cho hai endpoint
 * /auth/mfa/enroll/*. Sống 10 phút vì người dùng cần thời gian quét QR.
 */
export function signEnrollmentToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: 'mfa_enroll' } satisfies MfaEnrollmentPayload, env.JWT_ACCESS_SECRET, {
    expiresIn: 600,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: 'HS256',
  });
}

export function verifyEnrollmentToken(token: string): string {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER, audience: AUDIENCE, algorithms: ALGORITHMS });
  if (typeof decoded === 'string' || decoded.purpose !== 'mfa_enroll' || !decoded.sub) {
    throw new jwt.JsonWebTokenError('Token đăng ký MFA không hợp lệ');
  }
  return decoded.sub;
}
