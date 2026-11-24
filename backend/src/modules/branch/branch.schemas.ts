import { z } from 'zod';

export const createBranchSchema = z.object({
  name: z.string().trim().min(1, 'Vui lòng nhập tên chi nhánh').max(200),
  code: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(30).optional(),
  slotCapacity: z.coerce.number().int().min(1).max(1000).optional(),
  geoRadiusM: z.coerce.number().int().min(0).max(100000).optional(),
});

export const updateBranchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    code: z.string().trim().max(50).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    slotCapacity: z.coerce.number().int().min(1).max(1000).nullable().optional(),
    geoRadiusM: z.coerce.number().int().min(0).max(100000).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Cần ít nhất một trường để cập nhật');

export const assignUserSchema = z.object({
  userId: z.string().uuid('Mã nhân viên không hợp lệ'),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
