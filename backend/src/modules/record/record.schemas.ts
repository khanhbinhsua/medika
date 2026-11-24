import { z } from 'zod';

export const createPrescriptionSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
  encounterId: z.string().uuid().optional(),
  medication: z.string().trim().min(1, 'Vui lòng nhập tên thuốc').max(200),
  rxnormCode: z.string().trim().max(50).optional(),
  dosage: z.string().trim().min(1, 'Vui lòng nhập liều dùng').max(100),
  frequency: z.string().trim().min(1, 'Vui lòng nhập tần suất').max(100),
  durationDays: z.coerce.number().int().min(1).max(365).optional(),
  quantity: z.string().trim().max(50).optional(),
  instructions: z.string().trim().max(2000).optional(),
});

export const listPrescriptionsSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
  encounterId: z.string().uuid().optional(),
  status: z.enum(['active', 'completed', 'cancelled', 'expired']).optional(),
});

export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;
export type ListPrescriptionsQuery = z.infer<typeof listPrescriptionsSchema>;
