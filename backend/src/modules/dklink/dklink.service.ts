import { db } from '../../db/index.js';
import * as patientService from '../patient/patient.service.js';
import type { RequestMeta } from '../patient/patient.service.js';
import type { CreatePatientInput } from '../patient/patient.schemas.js';

// User hệ thống seed ở migration 1700000000025 — dùng làm created_by cho bệnh
// nhân được đẩy từ DK-link (webhook không có người đăng nhập).
const SYSTEM_USER_ID = '00000000-0000-0000-0000-0000000d11a1';
const SYSTEM_USER_EMAIL = 'dklink-integration@system.local';

export interface DkLinkPatient {
  id: string;
  full_name?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  address?: string | null | undefined;
  date_of_birth?: string | null | undefined;
}

export interface UpsertResult {
  action: 'created' | 'skipped';
  patientId: string;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * Tạo bệnh nhân trong CRM từ payload webhook DK-link (event patient.created).
 * Idempotent theo dklink_patient_id: webhook gửi lại → bỏ qua, không tạo trùng.
 *
 * DK-link chỉ có 1 trường Họ tên → dồn hết vào lastName (firstName = '.').
 * Bệnh nhân được mã hoá field-level qua patientService.createPatient (tái dùng
 * DEK/KMS + audit + sinh MRN sẵn có), created_by = user hệ thống.
 */
export async function upsertPatientFromDkLink(
  p: DkLinkPatient,
  meta: RequestMeta,
): Promise<UpsertResult> {
  const existing = await db
    .selectFrom('patients')
    .select(['id'])
    .where('dklink_patient_id', '=', p.id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (existing) return { action: 'skipped', patientId: existing.id };

  const fullName = (p.full_name ?? '').trim();
  const input: CreatePatientInput = {
    firstName: '.',
    lastName: fullName || '(chưa có tên)',
    // dob bắt buộc (dob_enc NOT NULL) — DK-link để trống thì lưu chuỗi rỗng đã
    // mã hoá; nhân viên bổ sung sau trong CRM nếu cần.
    dob: p.date_of_birth ?? '',
    email: p.email ? p.email.toLowerCase() : undefined,
    phone: p.phone ?? undefined,
    address: p.address ?? undefined,
  };

  const actor = { id: SYSTEM_USER_ID, email: SYSTEM_USER_EMAIL };
  try {
    const dto = await patientService.createPatient(input, actor, meta, { dklinkPatientId: p.id });
    return { action: 'created', patientId: dto.id };
  } catch (err) {
    // Hai webhook trùng chạy song song → unique(dklink_patient_id) chặn cái sau.
    if (isUniqueViolation(err)) {
      const row = await db
        .selectFrom('patients')
        .select(['id'])
        .where('dklink_patient_id', '=', p.id)
        .executeTakeFirst();
      if (row) return { action: 'skipped', patientId: row.id };
    }
    throw err;
  }
}
