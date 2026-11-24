import { z } from 'zod';

const questionSchema = z
  .object({
    id: z.string().trim().min(1).max(50),
    text: z.string().trim().min(1).max(500),
    type: z.enum(['scale', 'text', 'choice']),
    required: z.boolean().optional(),
    min: z.number().int().min(0).max(100).optional(),
    max: z.number().int().min(1).max(100).optional(),
    lowLabel: z.string().trim().max(60).optional(),
    highLabel: z.string().trim().max(60).optional(),
    primary: z.boolean().optional(),
    negativeAtOrBelow: z.number().int().min(0).max(100).optional(),
    options: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  })
  .refine((q) => q.type !== 'scale' || q.min === undefined || q.max === undefined || q.min < q.max, {
    message: 'Thang điểm: min phải nhỏ hơn max',
    path: ['min'],
  })
  .refine((q) => q.type !== 'choice' || (q.options && q.options.length >= 2), {
    message: 'Câu hỏi lựa chọn cần ít nhất 2 phương án',
    path: ['options'],
  });

export const createSurveySchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(['nps', 'csat', 'custom']),
  // Bỏ trống với nps/csat → service tự tạo câu hỏi mặc định.
  questions: z.array(questionSchema).max(20).optional(),
});

export const updateSurveySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    questions: z.array(questionSchema).max(20).optional(),
    status: z.enum(['draft', 'active', 'closed']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Cần ít nhất một trường để cập nhật');

export const sendInviteSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
  appointmentId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
});

export const dispatchAutoSchema = z.object({
  surveyId: z.string().uuid('Mã khảo sát không hợp lệ'),
  // Gửi khảo sát cho lịch hẹn 'completed' trong X giờ gần đây chưa được mời.
  sinceHours: z.number().int().min(1).max(720).optional(),
});

// Gửi từ link công khai (không đăng nhập). Ưu tiên `answers` (map câu hỏi → trả
// lời) cho khảo sát nhiều câu; `score`/`comment` giữ để tương thích ngược.
export const respondSchema = z.object({
  score: z.number().int().min(0).max(100).optional(),
  answers: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  comment: z.string().trim().max(2000).optional(),
});

export type CreateSurveyInput = z.infer<typeof createSurveySchema>;
export type RespondInput = z.infer<typeof respondSchema>;
