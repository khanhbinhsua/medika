import { z } from 'zod';

const isoDateTime = z
  .string()
  .datetime({ offset: true, message: 'Thời gian phải ở định dạng ISO 8601 kèm múi giờ' });

const cost = z.number().min(0, 'Chi phí không được âm').max(1_000_000_000, 'Chi phí quá lớn');

const stepInput = z.object({
  title: z.string().trim().min(1, 'Tên bước không được rỗng').max(300),
  description: z.string().trim().max(2000).optional(),
  cost: cost.optional(),
  scheduledDate: isoDateTime.optional(),
});

// Tạo phác đồ trực tiếp (nhập tay các bước).
export const createPlanSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
  doctorId: z.string().uuid('Mã bác sĩ không hợp lệ'),
  title: z.string().trim().min(1, 'Tiêu đề phác đồ không được rỗng').max(300),
  steps: z.array(stepInput).max(50, 'Tối đa 50 bước').optional(),
});

// Tạo phác đồ từ template mẫu (sao chép các bước của template).
export const createFromTemplateSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
  doctorId: z.string().uuid('Mã bác sĩ không hợp lệ'),
  templateId: z.string().uuid('Mã template không hợp lệ'),
  title: z.string().trim().min(1).max(300).optional(), // mặc định lấy tên template
});

export const addStepSchema = stepInput;

export const updateStepSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    cost: cost.optional(),
    status: z.enum(['pending', 'scheduled', 'completed', 'skipped', 'cancelled']).optional(),
    scheduledDate: isoDateTime.nullable().optional(),
    appointmentId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Cần ít nhất một trường để cập nhật');

export const cancelPlanSchema = z.object({
  reason: z.string().trim().min(1, 'Cần nêu lý do huỷ').max(1000),
});

export const listPlansSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
});

export const createTemplateSchema = z.object({
  code: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, 'Mã chỉ gồm chữ thường, số, gạch dưới'),
  name: z.string().trim().min(1).max(200),
  condition: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  steps: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        description: z.string().trim().max(2000).optional(),
        estimatedCost: cost.optional(),
      }),
    )
    .min(1, 'Template cần ít nhất một bước')
    .max(50),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type CreateFromTemplateInput = z.infer<typeof createFromTemplateSchema>;
export type AddStepInput = z.infer<typeof addStepSchema>;
export type UpdateStepInput = z.infer<typeof updateStepSchema>;
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
