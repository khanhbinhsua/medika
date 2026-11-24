import { describe, it, expect, beforeAll } from 'vitest';
import {
  initCrypto,
  generateDek,
  wrapDek,
  unwrapDek,
  encryptField,
  decryptField,
  encryptOptionalField,
  decryptOptionalField,
  searchHash,
  normalizeForSearch,
} from './field-encryption.js';

describe('field encryption', () => {
  beforeAll(async () => {
    await initCrypto();
  });

  it('mã hoá rồi giải mã trả về đúng plaintext', async () => {
    const dek = generateDek();
    const plaintext = 'Nguyễn Văn A';
    expect(decryptField(encryptField(plaintext, dek), dek)).toBe(plaintext);
  });

  it('sinh ciphertext khác nhau cho cùng plaintext (IV ngẫu nhiên)', async () => {
    const dek = generateDek();
    const a = encryptField('same value', dek);
    const b = encryptField('same value', dek);
    expect(a.equals(b)).toBe(false);
  });

  it('không giải mã được bằng DEK khác', async () => {
    const dek1 = generateDek();
    const dek2 = generateDek();
    const cipher = encryptField('bí mật', dek1);
    expect(() => decryptField(cipher, dek2)).toThrow();
  });

  it('phát hiện ciphertext bị sửa (GCM auth tag)', async () => {
    const dek = generateDek();
    const cipher = encryptField('toàn vẹn', dek);
    cipher[cipher.length - 1] = cipher[cipher.length - 1]! ^ 0xff;
    expect(() => decryptField(cipher, dek)).toThrow();
  });

  it('gắn version byte 0x01 ở đầu', async () => {
    const dek = generateDek();
    expect(encryptField('x', dek)[0]).toBe(0x01);
  });

  it('xử lý giá trị rỗng và null qua optional helper', async () => {
    const dek = generateDek();
    expect(encryptOptionalField(null, dek)).toBeNull();
    expect(encryptOptionalField('', dek)).toBeNull();
    expect(decryptOptionalField(null, dek)).toBeNull();
    expect(decryptOptionalField(encryptOptionalField('có giá trị', dek), dek)).toBe('có giá trị');
  });

  it('wrap rồi unwrap DEK trả về đúng khoá gốc', async () => {
    const dek = generateDek();
    const { wrapped } = await wrapDek(dek);
    expect((await unwrapDek(wrapped)).equals(dek)).toBe(true);
  });
});

describe('search hash', () => {
  beforeAll(async () => {
    await initCrypto();
  });

  it('xác định (deterministic) cho cùng đầu vào', () => {
    expect(searchHash('Nguyễn Văn A')).toBe(searchHash('Nguyễn Văn A'));
  });

  it('bỏ qua dấu tiếng Việt và hoa/thường', () => {
    expect(searchHash('Nguyễn Văn A')).toBe(searchHash('nguyen van a'));
  });

  it('phân biệt giá trị khác nhau', () => {
    expect(searchHash('Trần Thị B')).not.toBe(searchHash('Trần Thị C'));
  });

  it('chuẩn hoá khoảng trắng thừa', () => {
    expect(normalizeForSearch('  Lê   Thị   D  ')).toBe('le thi d');
  });

  it('chuyển đ thành d', () => {
    expect(normalizeForSearch('Đặng Đức')).toBe('dang duc');
  });
});
