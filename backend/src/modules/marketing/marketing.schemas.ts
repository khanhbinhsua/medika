import { z } from 'zod';

const isoDateTime = z
  .string()
  .datetime({ offset: true, message: 'Thời gian phải ở định dạng ISO 8601 kèm múi giờ' });

// Tiêu chí segment — chỉ trên trường KHÔNG phải PHI (query được bằng SQL).
export const criteriaSchema = z
  .object({
    gender: z.string().trim().max(20).optional(),
    minVisits: z.number().int().min(0).max(10000).optional(),
    maxVisits: z.number().int().min(0).max(10000).optional(),
    conditionLike: z.string().trim().min(1).max(100).optional(),
    inactiveSinceDays: z.number().int().min(1).max(3650).optional(),
    newWithinDays: z.number().int().min(1).max(3650).optional(),
    minTotalSpend: z.number().min(0).max(1_000_000_000_000).optional(),
    maxTotalSpend: z.number().min(0).max(1_000_000_000_000).optional(),
  })
  .strict()
  .refine((v) => v.minVisits === undefined || v.maxVisits === undefined || v.minVisits <= v.maxVisits, {
    message: 'minVisits phải ≤ maxVisits',
    path: ['minVisits'],
  });

export const createSegmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  criteria: criteriaSchema,
});

export const updateSegmentSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    criteria: criteriaSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Cần ít nhất một trường để cập nhật');

export const previewSchema = z.object({ criteria: criteriaSchema });

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  segmentId: z.string().uuid('Mã nhóm khách hàng không hợp lệ'),
  message: z.string().trim().min(1).max(2000),
  kind: z.enum(['marketing', 'treatment_next']).optional(),
  scheduledAt: isoDateTime.optional(),
});

export const createCareSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
  treatmentPlanId: z.string().uuid().optional(),
  careType: z.string().trim().min(1).max(50),
  message: z.string().trim().min(1).max(2000),
  delayHours: z.number().int().min(0).max(8760).optional(),
});

export const birthdaySchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

export type CriteriaInput = z.infer<typeof criteriaSchema>;
