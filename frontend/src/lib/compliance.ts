import { apiClient } from './api-client';
import type { Paginated } from './patients';

export interface AuditLog {
  id: string;
  requestId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  ipAddress: string | null;
  outcome: 'success' | 'failure' | 'denied';
  reason: string | null;
  createdAt: string;
}

export interface PhiAccessLog {
  id: string;
  patientId: string;
  patientMrn: string;
  patientName: string;
  accessType: string;
  fieldsAccessed: string[];
  purpose: string | null;
  ipAddress: string | null;
  actorEmail: string;
  actorName: string;
  accessedAt: string;
}

export interface IntegrityResult {
  valid: boolean;
  entriesChecked: number;
  brokenAtId?: string;
  kind?: 'broken_link' | 'content_modified';
  detail?: string;
  baselineId?: string;
  entriesBeforeBaseline?: number;
}

export interface Anomaly {
  kind: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  actorEmail: string | null;
  count: number;
  occurredAt: string;
}

export interface ComplianceSummary {
  activeUsers: number;
  activePatients: number;
  mfaEnabled: number;
  mfaCoveragePercent: number;
  phiAccessLast24h: number;
  deniedLast24h: number;
}

export async function fetchAuditLogs(params: Record<string, string | number | undefined>) {
  const { data } = await apiClient.get<Paginated<AuditLog>>('/audit/logs', { params });
  return data;
}

export async function fetchPhiAccess(params: Record<string, string | number | undefined>) {
  const { data } = await apiClient.get<Paginated<PhiAccessLog>>('/audit/phi-access', { params });
  return data;
}

export async function fetchIntegrity() {
  const { data } = await apiClient.get<IntegrityResult>('/audit/integrity');
  return data;
}

export async function fetchAnomalies(windowHours: number) {
  const { data } = await apiClient.get<{ windowHours: number; anomalies: Anomaly[] }>('/audit/anomalies', {
    params: { windowHours },
  });
  return data;
}

export async function fetchComplianceSummary() {
  const { data } = await apiClient.get<ComplianceSummary>('/audit/summary');
  return data;
}

// ── Đồng ý của bệnh nhân ──────────────────────────────────────────────

export type ConsentType = 'treatment' | 'privacy_notice' | 'data_sharing' | 'research' | 'marketing';

export interface Consent {
  id: string;
  patientId: string;
  consentType: ConsentType;
  granted: boolean;
  documentVersion: string;
  grantedAt: string;
  revokedAt: string | null;
  witnessedByName: string | null;
  notes: string | null;
}

export const CONSENT_LABELS: Record<ConsentType, string> = {
  treatment: 'Đồng ý điều trị',
  privacy_notice: 'Thông báo quyền riêng tư',
  data_sharing: 'Chia sẻ dữ liệu',
  research: 'Tham gia nghiên cứu',
  marketing: 'Nhận thông tin quảng bá',
};

export async function fetchConsents(patientId: string) {
  const { data } = await apiClient.get<Consent[]>('/consents', { params: { patientId } });
  return data;
}

export async function recordConsent(input: Record<string, unknown>) {
  const { data } = await apiClient.post<Consent>('/consents', input);
  return data;
}

export async function revokeConsent(consentId: string) {
  await apiClient.post(`/consents/${consentId}/revoke`);
}

// ── Nhãn hiển thị ─────────────────────────────────────────────────────

/** Nhóm hành động thành nhãn tiếng Việt đọc được cho người không rành kỹ thuật. */
export const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Đăng nhập thành công',
  LOGIN_SUCCESS_AFTER_ENROLLMENT: 'Đăng nhập sau khi bật MFA',
  LOGIN_FAILED: 'Đăng nhập thất bại',
  LOGIN_BLOCKED: 'Đăng nhập bị chặn',
  LOGIN_MFA_CHALLENGE: 'Yêu cầu mã xác thực',
  LOGIN_MFA_ENROLLMENT_REQUIRED: 'Yêu cầu thiết lập MFA',
  LOGIN_RECOVERY_CODE: 'Đăng nhập bằng mã khôi phục',
  LOGOUT: 'Đăng xuất',
  MFA_SETUP_STARTED: 'Bắt đầu thiết lập MFA',
  MFA_ENABLED: 'Đã bật MFA',
  MFA_FAILED: 'Mã xác thực sai',
  ACCESS_DENIED: 'Bị từ chối quyền',
  USER_SEEDED: 'Tạo tài khoản khởi tạo',
  PATIENT_CREATE: 'Tạo hồ sơ bệnh nhân',
  PATIENT_UPDATE: 'Sửa hồ sơ bệnh nhân',
  PATIENT_SOFT_DELETE: 'Ngừng theo dõi bệnh nhân',
  APPOINTMENT_CREATE: 'Đặt lịch hẹn',
  APPOINTMENT_UPDATE: 'Sửa lịch hẹn',
  APPOINTMENT_TRANSITION: 'Chuyển trạng thái lịch hẹn',
  APPOINTMENT_CANCEL: 'Huỷ lịch hẹn',
  RECORD_CREATE: 'Tạo hồ sơ y tế',
  RECORD_UPDATE: 'Sửa hồ sơ y tế',
  RECORD_SIGN: 'Ký hồ sơ y tế',
  PRESCRIPTION_CREATE: 'Kê đơn thuốc',
  CONSENT_GRANTED: 'Ghi nhận đồng ý',
  CONSENT_DENIED: 'Ghi nhận từ chối',
  CONSENT_REVOKED: 'Thu hồi đồng ý',
};

export const ACCESS_TYPE_LABELS: Record<string, string> = {
  view: 'Xem',
  create: 'Tạo mới',
  modify: 'Chỉnh sửa',
  export: 'Xuất dữ liệu',
  print: 'In',
};

export const OUTCOME_LABELS: Record<AuditLog['outcome'], string> = {
  success: 'Thành công',
  failure: 'Thất bại',
  denied: 'Bị từ chối',
};

export const SEVERITY_LABELS: Record<Anomaly['severity'], string> = {
  high: 'Nghiêm trọng',
  medium: 'Cần chú ý',
  low: 'Ghi nhận',
};
