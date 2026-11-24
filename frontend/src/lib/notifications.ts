import { apiClient } from './api-client';

export type NotificationChannel = 'zalo' | 'sms' | 'email';
export type NotificationKind =
  | 'appointment_reminder'
  | 'appointment_confirm'
  | 'appointment_cancel'
  | 'rebooking_reminder'
  | 'treatment_next'
  | 'survey'
  | 'marketing'
  | 'custom';

export interface NotificationTemplate {
  id: string;
  code: string;
  name: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  subject: string | null;
  content: string;
  zaloTemplateId: string | null;
  active: boolean;
}

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  status: 'pending' | 'sent' | 'failed' | 'read';
  channelSent: NotificationChannel | null;
  scheduledAt: string;
  sentAt: string | null;
  readAt: string | null;
  attempts: number;
  lastError: string | null;
}

export const KIND_VI: Record<NotificationKind, string> = {
  appointment_reminder: 'Nhắc lịch hẹn',
  appointment_confirm: 'Xác nhận lịch hẹn',
  appointment_cancel: 'Huỷ lịch hẹn',
  rebooking_reminder: 'Nhắc tái khám',
  treatment_next: 'Chăm sóc / điều trị tiếp',
  survey: 'Khảo sát',
  marketing: 'Marketing',
  custom: 'Tuỳ chỉnh',
};

export const CHANNEL_VI: Record<NotificationChannel, string> = {
  zalo: 'Zalo',
  sms: 'SMS',
  email: 'Email',
};

export const NOTIFY_STATUS_VI: Record<string, string> = {
  pending: 'Chờ gửi',
  sent: 'Đã gửi',
  failed: 'Thất bại',
  read: 'Đã đọc',
};

export async function listTemplates(): Promise<NotificationTemplate[]> {
  const { data } = await apiClient.get<NotificationTemplate[]>('/notifications/templates');
  return data;
}

export async function updateTemplate(
  id: string,
  input: { name?: string; subject?: string | null; content?: string; zaloTemplateId?: string | null; active?: boolean },
): Promise<NotificationTemplate> {
  const { data } = await apiClient.patch<NotificationTemplate>(`/notifications/templates/${id}`, input);
  return data;
}

export async function sendNotification(input: {
  patientId: string;
  kind: NotificationKind;
  vars?: Record<string, string>;
}): Promise<{ id: string; status: string; channelSent: string | null }> {
  const { data } = await apiClient.post('/notifications/send', input);
  return data;
}

export async function listForPatient(patientId: string): Promise<NotificationRow[]> {
  const { data } = await apiClient.get<NotificationRow[]>(`/notifications/patient/${patientId}`);
  return data;
}
