import { z } from 'zod';
import { passwordSchema } from '../auth/auth.schemas.js';

// Vai trò nhân viên có thể gán. 'auditor' = kiểm toán (chỉ đọc nhật ký/báo cáo);
// 'sales' = kinh doanh; 'customer_care' = chăm sóc khách hàng (CSKH).
export const ASSIGNABLE_ROLES = [
  'admin',
  'doctor',
  'nurse',
  'receptionist',
  'auditor',
  'sales',
  'customer_care',
] as const;

export const createUserSchema = z.object({
  email: z.string().email('Email không hợp lệ').toLowerCase(),
  fullName: z.string().trim().min(1, 'Vui lòng nhập họ tên').max(120),
  role: z.enum(ASSIGNABLE_ROLES),
  password: passwordSchema,
});

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    role: z.enum(ASSIGNABLE_ROLES).optional(),
    status: z.enum(['active', 'suspended', 'disabled']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Cần ít nhất một trường để cập nhật');

export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
