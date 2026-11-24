import { authenticator } from 'otplib';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { encryptField, decryptField, generateDek, wrapDek, unwrapDek } from '../../crypto/field-encryption.js';

// Cho phép lệch ±1 bước (30s) để bù trôi đồng hồ máy khách.
authenticator.options = { window: 1, step: 30 };

export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpAuthUrl(email: string, secret: string): string {
  return authenticator.keyuri(email, env.MFA_ISSUER, secret);
}

const TOTP_STEP_SECONDS = 30;

/**
 * Xác thực TOTP và trả về bước thời gian (unix_time/30) đã khớp — dùng để
 * chặn tái sử dụng (RFC 6238 §5.2). `checkDelta` trả độ lệch so với bước hiện
 * tại (0 = đúng bước hiện tại, ±1 = lệch trong cửa sổ cho phép, null = sai).
 */
export function verifyTotpStep(secret: string, token: string): number | null {
  let delta: number | null;
  try {
    delta = authenticator.checkDelta(token, secret);
  } catch {
    return null;
  }
  if (delta === null) return null;

  const currentStep = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  return currentStep + delta;
}

/** Secret TOTP được mã hoá bằng DEK riêng trước khi lưu DB. */
export async function encryptMfaSecret(secret: string): Promise<{ secretEnc: Buffer; wrappedDek: Buffer; kekReference: string }> {
  const dek = generateDek();
  const secretEnc = encryptField(secret, dek);
  const { wrapped, kekReference } = await wrapDek(dek);
  return { secretEnc, wrappedDek: wrapped, kekReference };
}

export async function decryptMfaSecret(secretEnc: Buffer, wrappedDek: Buffer): Promise<string> {
  const dek = await unwrapDek(wrappedDek);
  return decryptField(secretEnc, dek);
}

const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCodes(): { plain: string[]; hashed: string[] } {
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-'),
  );
  return { plain, hashed: plain.map(hashRecoveryCode) };
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.replace(/-/g, '').toUpperCase()).digest('hex');
}

/** So sánh thời-gian-hằng để tránh timing attack. */
export function matchRecoveryCode(input: string, hashedCodes: string[]): string | null {
  const inputHash = Buffer.from(hashRecoveryCode(input), 'hex');
  for (const stored of hashedCodes) {
    const storedBuf = Buffer.from(stored, 'hex');
    if (storedBuf.length === inputHash.length && timingSafeEqual(storedBuf, inputHash)) {
      return stored;
    }
  }
  return null;
}
