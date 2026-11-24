import { z } from 'zod';

/** Loại chi tiêu — dùng cho phân rã theo nhóm dịch vụ. */
export const CATEGORIES = ['kham', 'thuoc', 'cls', 'thu_thuat', 'khac'] as const;

const dateString = z
  .string()
  .trim()
  .min(1, 'Thiếu thời điểm')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Thời điểm không hợp lệ')
  .refine((v) => Date.parse(v) <= Date.now() + 86_400_000, 'Thời điểm không thể ở tương lai');

const amount = z.coerce.number({ invalid_type_error: 'Số tiền không hợp lệ' })
  .finite()
  .min(0, 'Số tiền không âm')
  .max(1_000_000_000_000, 'Số tiền quá lớn');

const note = z.string().trim().max(500).optional();
const category = z.enum(CATEGORIES).default('khac');

export const createTransactionSchema = z.object({
  occurredAt: dateString,
  amount,
  category,
  note,
});

export const updateTransactionSchema = z
  .object({
    occurredAt: dateString.optional(),
    amount: amount.optional(),
    category: z.enum(CATEGORIES).optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Cần ít nhất một trường để cập nhật');

export const listTransactionsSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const topSpendersSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  tier: z.enum(['thuong', 'bac', 'vang', 'kim_cuong']).optional(),
});

/** Nhập hàng loạt từ CSV — mỗi dòng khớp bệnh nhân qua MRN. */
export const importSchema = z.object({
  rows: z
    .array(
      z.object({
        mrn: z.string().trim().min(1, 'Thiếu mã bệnh nhân'),
        occurredAt: dateString,
        amount,
        category: z.enum(CATEGORIES).optional(),
        note,
      }),
    )
    .min(1, 'Không có dòng nào')
    .max(5000, 'Tối đa 5000 dòng mỗi lần nhập'),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsSchema>;
export type TopSpendersQuery = z.infer<typeof topSpendersSchema>;
export type ImportInput = z.infer<typeof importSchema>;
