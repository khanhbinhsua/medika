import { z } from 'zod';

/**
 * 12 ký tự là mức tối thiểu theo NIST SP 800-63B khi có MFA.
 * Không ép "phải có ký tự đặc biệt" — NIST khuyến nghị bỏ quy tắc kiểu đó
 * vì nó đẩy người dùng tới mật khẩu dễ đoán.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Mật khẩu phải có ít nhất 12 ký tự')
  .max(128, 'Mật khẩu quá dài');

export const loginSchema = z.object({
  email: z.string().email('Email không hợp lệ').toLowerCase(),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().regex(/^[0-9]{6}$/, 'Mã xác thực gồm 6 chữ số'),
});

export const mfaRecoverySchema = z.object({
  mfaToken: z.string().min(1),
  recoveryCode: z.string().min(1),
});

export const mfaConfirmSchema = z.object({
  code: z.string().regex(/^[0-9]{6}$/, 'Mã xác thực gồm 6 chữ số'),
});

export const enrollStartSchema = z.object({
  enrollmentToken: z.string().min(1),
});

export const enrollConfirmSchema = z.object({
  enrollmentToken: z.string().min(1),
  code: z.string().regex(/^[0-9]{6}$/, 'Mã xác thực gồm 6 chữ số'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;
export type MfaRecoveryInput = z.infer<typeof mfaRecoverySchema>;
export type MfaConfirmInput = z.infer<typeof mfaConfirmSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
