import { z } from 'zod';

export const createComplaintSchema = z.object({
  category: z.enum(['service', 'attitude', 'price', 'result', 'wait_time', 'other']),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
  title: z.string().trim().min(1, 'Cần tiêu đề').max(200),
  detail: z.string().trim().max(4000).optional(),
  assignedTo: z.string().uuid().optional(),
});

export const updateComplaintSchema = z
  .object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
    severity: z.enum(['low', 'medium', 'high']).optional(),
    assignedTo: z.string().uuid().nullable().optional(),
    resolution: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Cần ít nhất một trường để cập nhật');

export type CreateComplaintInput = z.infer<typeof createComplaintSchema>;
export type UpdateComplaintInput = z.infer<typeof updateComplaintSchema>;
