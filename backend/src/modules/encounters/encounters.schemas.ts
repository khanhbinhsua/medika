import { z } from 'zod';

const icd10 = z.string().trim().regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/, 'Mã ICD-10 không hợp lệ');
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ');
const txt = (max = 5000) => z.string().trim().max(max);

// Sinh hiệu — lưu jsonb, các chỉ số đều tuỳ chọn (chuỗi để giữ "120/80").
export const vitalsSchema = z.object({
  pulse: z.string().trim().max(20).optional(),
  temp: z.string().trim().max(20).optional(),
  bp: z.string().trim().max(20).optional(),
  resp: z.string().trim().max(20).optional(),
  weight: z.string().trim().max(20).optional(),
  height: z.string().trim().max(20).optional(),
  spo2: z.string().trim().max(20).optional(),
}).strict();

export const createEncounterSchema = z.object({
  patientId: z.string().uuid('Mã bệnh nhân không hợp lệ'),
  appointmentId: z.string().uuid().optional(),
});

const clinicalFields = {
  reason: txt(2000).optional(),
  history: txt().optional(),
  pastPersonal: txt(2000).optional(),
  pastFamily: txt(2000).optional(),
  vitals: vitalsSchema.optional(),
  examGeneral: txt().optional(),
  examOrgans: txt().optional(),
  labsSummary: txt().optional(),
  treatment: txt().optional(),
  dxNote: txt(2000).optional(),
  dxPrimaryIcd10: icd10.nullable().optional(),
  dxSecondaryIcd10: z.array(icd10).max(20).optional(),
  treatmentFrom: dateOnly.nullable().optional(),
  treatmentTo: dateOnly.nullable().optional(),
};

export const updateEncounterSchema = z.object(clinicalFields).refine((v) => Object.keys(v).length > 0, 'Cần ít nhất một trường');
export const amendEncounterSchema = z.object({
  ...clinicalFields,
  changeReason: z.string().trim().min(3, 'Vui lòng nêu lý do sửa bổ sung').max(500),
});

export type CreateEncounterInput = z.infer<typeof createEncounterSchema>;
export type UpdateEncounterInput = z.infer<typeof updateEncounterSchema>;
export type AmendEncounterInput = z.infer<typeof amendEncounterSchema>;
