import { apiClient } from './api-client';
import type { Paginated } from './patients';

// ── Lịch hẹn ──────────────────────────────────────────────────────────

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'checked_in'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  doctorId: string;
  doctorName: string;
  scheduledStart: string;
  scheduledEnd: string;
  room: string | null;
  status: AppointmentStatus;
  reason: string | null;
  cancelReason: string | null;
  checkedInAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Đã đặt',
  confirmed: 'Đã xác nhận',
  checked_in: 'Đã đến',
  in_progress: 'Đang khám',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
  no_show: 'Không đến',
};

/** Khớp với ALLOWED_TRANSITIONS ở backend — nút nào hiện ra tuỳ trạng thái. */
export const NEXT_STATUSES: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['confirmed', 'checked_in', 'no_show'],
  confirmed: ['checked_in', 'no_show'],
  checked_in: ['in_progress'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export async function fetchAppointments(params: Record<string, string | number | undefined>) {
  const { data } = await apiClient.get<Paginated<Appointment>>('/appointments', { params });
  return data;
}

export interface AppointmentCounts {
  total: number;
  byStatus: Record<string, number>;
}
export async function fetchAppointmentCounts(params: Record<string, string | number | undefined>) {
  const { data } = await apiClient.get<AppointmentCounts>('/appointments/counts', { params });
  return data;
}

export const APPOINTMENT_SOURCE_LABELS: Record<string, string> = {
  prebooked: 'Đặt trước',
  phone: 'Điện thoại',
  online: 'Online',
  walkin: 'Vãng lai',
};

export async function createAppointment(input: Record<string, unknown>) {
  const { data } = await apiClient.post<Appointment>('/appointments', input);
  return data;
}

export async function changeAppointmentStatus(id: string, status: AppointmentStatus) {
  const { data } = await apiClient.post<Appointment>(`/appointments/${id}/status`, { status });
  return data;
}

export async function cancelAppointment(id: string, reason: string) {
  const { data } = await apiClient.post<Appointment>(`/appointments/${id}/cancel`, { reason });
  return data;
}

// ── Đơn thuốc ─────────────────────────────────────────────────────────

export interface Prescription {
  id: string;
  patientId: string;
  recordId: string | null;
  prescriberName: string;
  medication: string;
  dosage: string;
  frequency: string;
  durationDays: number | null;
  quantity: string | null;
  instructions: string | null;
  status: 'active' | 'completed' | 'cancelled' | 'expired';
  prescribedAt: string;
  expiresAt: string | null;
}

export const PRESCRIPTION_STATUS_LABELS: Record<Prescription['status'], string> = {
  active: 'Đang dùng',
  completed: 'Đã xong',
  cancelled: 'Đã huỷ',
  expired: 'Hết hạn',
};

export async function fetchPrescriptions(patientId: string, encounterId?: string) {
  const { data } = await apiClient.get<Prescription[]>('/prescriptions', { params: { patientId, ...(encounterId ? { encounterId } : {}) } });
  return data;
}

export async function createPrescription(input: Record<string, unknown>) {
  const { data } = await apiClient.post<Prescription>('/prescriptions', input);
  return data;
}

// ── Định dạng ─────────────────────────────────────────────────────────

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTimeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const time = (d: Date) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return `${time(start)}–${time(end)}`;
}

export function statusTone(status: AppointmentStatus): 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' {
  switch (status) {
    case 'completed':
      return 'ok';
    case 'in_progress':
    case 'checked_in':
      return 'accent';
    case 'cancelled':
    case 'no_show':
      return 'danger';
    default:
      return 'neutral';
  }
}

// ── Tài liệu y tế ─────────────────────────────────────────────────────

export interface MedicalDocument {
  id: string;
  patientId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: string;
}

export async function fetchDocuments(patientId: string) {
  const { data } = await apiClient.get<MedicalDocument[]>('/documents', { params: { patientId } });
  return data;
}

export async function uploadDocument(patientId: string, file: File) {
  const form = new FormData();
  form.append('patientId', patientId);
  form.append('file', file);
  const { data } = await apiClient.post<MedicalDocument>('/documents', form);
  return data;
}

/** Tải file qua blob (giữ Authorization header — không mở URL trực tiếp được). */
export async function downloadDocument(id: string, fileName: string) {
  const res = await apiClient.get(`/documents/${id}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function deleteDocument(id: string) {
  await apiClient.delete(`/documents/${id}`);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Nhắc lịch ─────────────────────────────────────────────────────────

export interface Reminder {
  id: string;
  channel: 'email' | 'sms';
  scheduledFor: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  sentAt: string | null;
  attempts: number;
  failureReason: string | null;
}

export const REMINDER_STATUS_LABELS: Record<Reminder['status'], string> = {
  pending: 'Chờ gửi',
  sent: 'Đã gửi',
  failed: 'Thất bại',
  cancelled: 'Đã huỷ',
};

export const CHANNEL_LABELS: Record<Reminder['channel'], string> = {
  email: 'Email',
  sms: 'SMS',
};

export function reminderTone(status: Reminder['status']): 'neutral' | 'ok' | 'warn' | 'danger' {
  switch (status) {
    case 'sent':
      return 'ok';
    case 'pending':
      return 'warn';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

export async function fetchReminders(appointmentId: string) {
  const { data } = await apiClient.get<Reminder[]>(`/reminders/appointment/${appointmentId}`);
  return data;
}
