import { z } from 'zod';

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải theo định dạng YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Ngày không hợp lệ');

export const slotsQuerySchema = z.object({
  branchId: z.string().uuid('Mã chi nhánh không hợp lệ'),
  date: dateOnly,
});

export const createBookingSchema = z.object({
  branchId: z.string().uuid('Vui lòng chọn chi nhánh'),
  start: z.string().datetime({ offset: true }),
  fullName: z.string().trim().min(1, 'Vui lòng nhập họ tên').max(120),
  phone: z.string().trim().min(6, 'Số điện thoại không hợp lệ').max(20),
  note: z.string().trim().max(500).optional(),
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày sinh phải theo định dạng YYYY-MM-DD')
  .refine((v) => Date.parse(v) <= Date.now(), 'Ngày sinh không thể ở tương lai');

export const confirmBookingSchema = z
  .object({
    doctorId: z.string().uuid('Vui lòng chọn bác sĩ'),
    // Một trong hai: liên kết bệnh nhân có sẵn, hoặc tạo mới.
    patientId: z.string().uuid().optional(),
    newPatient: z
      .object({
        firstName: z.string().trim().min(1).max(100),
        lastName: z.string().trim().min(1).max(100),
        dob: isoDate,
        gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
      })
      .optional(),
  })
  .refine((v) => !!v.patientId || !!v.newPatient, 'Cần chọn bệnh nhân có sẵn hoặc tạo mới');

export const rejectBookingSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type ConfirmBookingInput = z.infer<typeof confirmBookingSchema>;
export const SLOT_MINUTES = 30;
