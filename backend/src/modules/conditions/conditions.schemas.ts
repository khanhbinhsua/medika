import { z } from 'zod';

export const CONDITION_STATUSES = ['active', 'chronic', 'resolved'] as const;
export const SEVERITIES = ['mild', 'moderate', 'severe', 'life_threatening'] as const;

const icd10 = z
  .string()
  .trim()
  .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/, 'Mã ICD-10 không hợp lệ (ví dụ: E11.9)');

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải theo định dạng YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Ngày không hợp lệ');

export const createConditionSchema = z.object({
  condition: z.string().trim().min(1, 'Vui lòng nhập tên bệnh lý').max(200),
  icd10Code: icd10.optional(),
  status: z.enum(CONDITION_STATUSES).default('active'),
  onsetDate: dateOnly.optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const updateConditionSchema = z
  .object({
    condition: z.string().trim().min(1).max(200).optional(),
    icd10Code: icd10.nullable().optional(),
    status: z.enum(CONDITION_STATUSES).optional(),
    onsetDate: dateOnly.nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Cần ít nhất một trường để cập nhật');

export const createAllergySchema = z.object({
  allergyName: z.string().trim().min(1, 'Vui lòng nhập tên dị nguyên').max(200),
  reaction: z.string().trim().max(300).optional(),
  severity: z.enum(SEVERITIES).default('moderate'),
  notes: z.string().trim().max(1000).optional(),
});

export type CreateConditionInput = z.infer<typeof createConditionSchema>;
export type UpdateConditionInput = z.infer<typeof updateConditionSchema>;
export type CreateAllergyInput = z.infer<typeof createAllergySchema>;
