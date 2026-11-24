import { z } from 'zod';

const isoDateTime = z
  .string()
  .datetime({ offset: true, message: 'Thời gian phải ở định dạng ISO 8601 kèm múi giờ' });

export const createAppointmentSchema = z
  .object({
    patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
    doctorId: z.string().uuid('Mã bác sĩ không hợp lệ'),
    scheduledStart: isoDateTime,
    scheduledEnd: isoDateTime,
    room: z.string().trim().max(50).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((v) => new Date(v.scheduledEnd) > new Date(v.scheduledStart), {
    message: 'Giờ kết thúc phải sau giờ bắt đầu',
    path: ['scheduledEnd'],
  })
  .refine((v) => (new Date(v.scheduledEnd).getTime() - new Date(v.scheduledStart).getTime()) <= 8 * 3600_000, {
    message: 'Một lịch hẹn không thể kéo dài quá 8 giờ',
    path: ['scheduledEnd'],
  });

export const updateAppointmentSchema = z
  .object({
    scheduledStart: isoDateTime.optional(),
    scheduledEnd: isoDateTime.optional(),
    room: z.string().trim().max(50).nullable().optional(),
    reason: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Cần ít nhất một trường để cập nhật')
  .refine(
    (v) =>
      // Đổi giờ thì phải gửi cả hai mốc, nếu không sẽ tạo ra khoảng thời gian vô nghĩa.
      (v.scheduledStart === undefined) === (v.scheduledEnd === undefined),
    { message: 'Khi đổi lịch phải gửi cả giờ bắt đầu và giờ kết thúc', path: ['scheduledStart'] },
  )
  .refine(
    (v) => !v.scheduledStart || !v.scheduledEnd || new Date(v.scheduledEnd) > new Date(v.scheduledStart),
    { message: 'Giờ kết thúc phải sau giờ bắt đầu', path: ['scheduledEnd'] },
  );

/** Các bước chuyển trạng thái hợp lệ, xem thêm ALLOWED_TRANSITIONS ở service. */
export const transitionSchema = z.object({
  status: z.enum(['confirmed', 'checked_in', 'in_progress', 'completed', 'no_show']),
});

export const cancelAppointmentSchema = z.object({
  reason: z.string().trim().min(1, 'Vui lòng nêu lý do huỷ').max(500),
});

export const listAppointmentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  patientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  status: z
    .enum(['scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'])
    .optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type TransitionInput = z.infer<typeof transitionSchema>;
export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsSchema>;
