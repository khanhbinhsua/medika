import { apiClient } from './api-client';

export type ComplaintStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export const COMPLAINT_STATUS_VI: Record<string, string> = {
  open: 'Mở', in_progress: 'Đang xử lý', resolved: 'Đã xử lý', closed: 'Đã đóng',
};
export const COMPLAINT_STATUS_TONE: Record<string, 'neutral' | 'ok' | 'warn' | 'danger'> = {
  open: 'danger', in_progress: 'warn', resolved: 'ok', closed: 'neutral',
};
export const COMPLAINT_CATEGORY_VI: Record<string, string> = {
  service: 'Dịch vụ', attitude: 'Thái độ', price: 'Giá', result: 'Kết quả', wait_time: 'Thời gian chờ', other: 'Khác',
};
export const COMPLAINT_SEVERITY_VI: Record<string, string> = { low: 'Thấp', medium: 'Trung bình', high: 'Cao' };
export const COMPLAINT_SEVERITY_TONE: Record<string, 'neutral' | 'warn' | 'danger'> = { low: 'neutral', medium: 'warn', high: 'danger' };

export const COMPLAINT_CATEGORIES = ['service', 'attitude', 'price', 'result', 'wait_time', 'other'] as const;
export const COMPLAINT_SEVERITIES = ['low', 'medium', 'high'] as const;
export const COMPLAINT_STATUSES: ComplaintStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

/** Khiếu nại được coi là "đang mở" khi chưa xử lý xong. */
export const isOpenComplaint = (status: string) => status === 'open' || status === 'in_progress';

export interface ComplaintListItem {
  id: string; code: string; patientId: string; category: string; severity: string;
  status: string; title: string; assignedToName: string | null;
  resolvedAt: string | null; createdAt: string;
}
export interface ComplaintDetail extends ComplaintListItem {
  detail: string | null;
  resolution: string | null;
}

export async function fetchComplaints(patientId: string): Promise<ComplaintListItem[]> {
  const { data } = await apiClient.get<ComplaintListItem[]>(`/complaints/patients/${patientId}`);
  return data;
}
export async function getComplaint(id: string): Promise<ComplaintDetail> {
  const { data } = await apiClient.get<ComplaintDetail>(`/complaints/${id}`);
  return data;
}
export async function createComplaint(
  patientId: string,
  body: { category: string; severity: string; title: string; detail?: string },
): Promise<ComplaintDetail> {
  const { data } = await apiClient.post<ComplaintDetail>(`/complaints/patients/${patientId}`, body);
  return data;
}
export async function updateComplaint(
  id: string,
  body: Partial<{ status: ComplaintStatus; severity: string; resolution: string | null }>,
): Promise<ComplaintDetail> {
  const { data } = await apiClient.patch<ComplaintDetail>(`/complaints/${id}`, body);
  return data;
}
