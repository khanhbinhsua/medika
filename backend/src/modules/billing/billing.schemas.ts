import { z } from 'zod';

const vnd = z.coerce.number().int('Số tiền phải là số nguyên (VND)').min(0).max(1_000_000_000_000);
const vndPos = z.coerce.number().int().min(1).max(1_000_000_000_000);

export const createOrderSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
  branchId: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});

export const addLineSchema = z
  .object({
    serviceId: z.string().uuid().optional(),
    packageId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    unitPriceVnd: vnd.optional(),
    qty: z.coerce.number().int().min(1).max(999).default(1),
    discountVnd: vnd.default(0),
  })
  .refine((v) => v.serviceId || v.packageId || (v.name && v.unitPriceVnd !== undefined), {
    message: 'Cần chọn dịch vụ/gói hoặc nhập tên + đơn giá',
  });

export const takePaymentSchema = z.object({
  method: z.enum(['cash', 'transfer', 'card', 'prepaid', 'other']),
  amountVnd: vndPos,
});

export const listOrdersSchema = z.object({
  status: z.enum(['draft', 'unpaid', 'partial', 'paid', 'cancelled']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type AddLineInput = z.infer<typeof addLineSchema>;
export type TakePaymentInput = z.infer<typeof takePaymentSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersSchema>;
