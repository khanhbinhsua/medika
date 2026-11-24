import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày sinh phải theo định dạng YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Ngày sinh không hợp lệ')
  .refine((v) => new Date(v).getTime() <= Date.now(), 'Ngày sinh không thể ở tương lai');

export const createPatientSchema = z.object({
  firstName: z.string().trim().min(1, 'Vui lòng nhập tên').max(100),
  lastName: z.string().trim().min(1, 'Vui lòng nhập họ').max(100),
  dob: isoDate,
  gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  email: z.string().email('Email không hợp lệ').toLowerCase().optional(),
  phone: z.string().trim().min(6).max(20).optional(),
  address: z.string().trim().max(500).optional(),
  insuranceId: z.string().trim().max(100).optional(),
});

export const updatePatientSchema = createPatientSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Cần ít nhất một trường để cập nhật',
);

export const listPatientsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).optional(),
  status: z.enum(['active', 'inactive', 'deceased', 'merged']).optional(),
});

export const listDeletedPatientsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const purgePatientSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Vui lòng nêu lý do đầy đủ (tối thiểu 10 ký tự) — đây là hành động không thể hoàn tác')
    .max(1000),
});

export type CreatePatientInput = z.infer<typeof createPatientSchema>;
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;
export type ListPatientsQuery = z.infer<typeof listPatientsSchema>;
export type ListDeletedPatientsQuery = z.infer<typeof listDeletedPatientsSchema>;
export type PurgePatientInput = z.infer<typeof purgePatientSchema>;
