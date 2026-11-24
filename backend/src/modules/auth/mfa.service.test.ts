import { describe, it, expect } from 'vitest';
import { authenticator } from 'otplib';
import { generateMfaSecret, verifyTotpStep } from './mfa.service.js';

describe('verifyTotpStep', () => {
  it('trả về null cho mã sai', () => {
    const secret = generateMfaSecret();
    expect(verifyTotpStep(secret, '000000')).toBeNull();
  });

  it('trả về đúng bước hiện tại cho mã hợp lệ', () => {
    const secret = generateMfaSecret();
    const token = authenticator.generate(secret);
    const expectedStep = Math.floor(Date.now() / 1000 / 30);

    expect(verifyTotpStep(secret, token)).toBe(expectedStep);
  });

  it('hai lần gọi liên tiếp cùng một mã trả về cùng một bước', () => {
    // Đây chính là tiền đề mà chốt chặn tái sử dụng (claimTotpStep) dựa vào:
    // cùng một mã luôn cho cùng một số bước, nên "đã dùng bước X" chặn được
    // việc dùng lại đúng mã đó. Phần đảm bảo nguyên tử (UPDATE ... WHERE) nằm
    // ở tầng DB nên được kiểm chứng qua smoke test, không phải unit test này.
    const secret = generateMfaSecret();
    const token = authenticator.generate(secret);

    expect(verifyTotpStep(secret, token)).toBe(verifyTotpStep(secret, token));
  });
});
