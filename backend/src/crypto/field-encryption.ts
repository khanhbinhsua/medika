import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { getKekProvider, KEY_BYTES } from './kek-provider.js';

/**
 * AES-256-GCM: thuật toán được NIST phê duyệt (FIPS 140-2), là chuẩn mà
 * hướng dẫn của HHS về "encryption safe harbor" cho HIPAA tham chiếu tới
 * (NIST SP 800-111). GCM cho cả tính bí mật lẫn tính toàn vẹn (AEAD).
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION_BYTE = 0x01;

/** Giữ lại để server.ts gọi lúc khởi động — node:crypto không cần khởi tạo bất đồng bộ. */
export async function initCrypto(): Promise<void> {
  // Xác thực sớm rằng khoá cấu hình hợp lệ, thay vì để lỗi xuất hiện lúc ghi dữ liệu.
  await getKekProvider();
  if (Buffer.from(env.SEARCH_HMAC_KEY, 'base64').length !== KEY_BYTES) {
    throw new Error(`SEARCH_HMAC_KEY phải dài ${KEY_BYTES} byte sau khi decode base64`);
  }
}

export function generateDek(): Buffer {
  return randomBytes(KEY_BYTES);
}

export async function wrapDek(dek: Buffer): Promise<{ wrapped: Buffer; kekReference: string }> {
  const kek = await getKekProvider();
  return { wrapped: await kek.wrapDek(dek), kekReference: kek.reference };
}

export async function unwrapDek(wrapped: Buffer): Promise<Buffer> {
  const kek = await getKekProvider();
  return kek.unwrapDek(wrapped);
}

/**
 * Ciphertext layout: [version:1][iv:12][authTag:16][ciphertext]
 * Version byte cho phép xoay thuật toán về sau mà không phá dữ liệu cũ.
 *
 * Lõi nhị phân — nhận/trả Buffer thẳng, không ép qua string. Dùng cho nội
 * dung file (vài MB, ép qua string trung gian vừa tốn bộ nhớ vừa sai với dữ
 * liệu không phải text như PDF/ảnh). `encryptField`/`decryptField` bên dưới
 * chỉ là lớp mỏng bọc UTF-8 cho các trường text thông thường.
 */
export function encryptBuffer(plaintext: Buffer, dek: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, dek, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION_BYTE]), iv, cipher.getAuthTag(), body]);
}

export function decryptBuffer(ciphertext: Buffer, dek: Buffer): Buffer {
  if (ciphertext[0] !== VERSION_BYTE) {
    throw new Error(`Phiên bản ciphertext không hỗ trợ: ${ciphertext[0]}`);
  }
  if (ciphertext.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new Error('Ciphertext không hợp lệ');
  }
  const iv = ciphertext.subarray(1, 1 + IV_BYTES);
  const tag = ciphertext.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, dek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext.subarray(1 + IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
}

export function encryptField(plaintext: string, dek: Buffer): Buffer {
  return encryptBuffer(Buffer.from(plaintext, 'utf8'), dek);
}

export function decryptField(ciphertext: Buffer, dek: Buffer): string {
  return decryptBuffer(ciphertext, dek).toString('utf8');
}

export function encryptOptionalField(value: string | null | undefined, dek: Buffer): Buffer | null {
  return value === null || value === undefined || value === '' ? null : encryptField(value, dek);
}

export function decryptOptionalField(value: Buffer | null | undefined, dek: Buffer): string | null {
  return value === null || value === undefined ? null : decryptField(value, dek);
}

/**
 * HMAC xác định (deterministic) để tìm kiếm chính xác trên cột đã mã hoá.
 * Dùng khoá RIÊNG, không phải DEK — nếu lộ hash không suy ra được plaintext,
 * và nếu lộ khoá HMAC cũng không giải mã được dữ liệu.
 */
export function searchHash(value: string): string {
  const key = Buffer.from(env.SEARCH_HMAC_KEY, 'base64');
  return createHmac('sha256', key).update(normalizeForSearch(value), 'utf8').digest('hex');
}

export function searchHashMatches(value: string, storedHash: string): boolean {
  const a = Buffer.from(searchHash(value), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Xoá khoá khỏi bộ nhớ sau khi dùng xong. */
export function zeroize(key: Buffer): void {
  key.fill(0);
}
