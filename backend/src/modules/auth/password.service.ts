import argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';

// Tham số theo khuyến nghị OWASP 2024 cho Argon2id.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Hash cũ dùng tham số yếu hơn cần được nâng cấp khi user đăng nhập thành công. */
export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, ARGON2_OPTIONS);
}

export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Token (refresh, reset password) lưu DB dưới dạng hash — lộ DB không dùng lại được token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
