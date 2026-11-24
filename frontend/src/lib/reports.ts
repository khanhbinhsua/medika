import { apiClient } from './api-client';

export interface ReportOverview {
  activePatients: number;
  newPatientsLast30d: number;
  appointmentsUpcoming: number;
  appointmentsCompletedLast30d: number;
  activePrescriptions: number;
  documentsTotal: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface TimelinePoint {
  day: string;
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
}

export interface ProviderProductivity {
  doctorId: string;
  doctorName: string;
  appointments: number;
  completed: number;
  prescriptions: number;
}

function rangeParams(from?: string, to?: string) {
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  return params;
}

export async function fetchOverview() {
  const { data } = await apiClient.get<ReportOverview>('/reports/overview');
  return data;
}

export async function fetchAppointmentsByStatus(from?: string, to?: string) {
  const { data } = await apiClient.get<StatusCount[]>('/reports/appointments/by-status', { params: rangeParams(from, to) });
  return data;
}

export async function fetchAppointmentsTimeline(from?: string, to?: string) {
  const { data } = await apiClient.get<TimelinePoint[]>('/reports/appointments/timeline', { params: rangeParams(from, to) });
  return data;
}

export async function fetchProviderProductivity(from?: string, to?: string) {
  const { data } = await apiClient.get<ProviderProductivity[]>('/reports/provider-productivity', { params: rangeParams(from, to) });
  return data;
}

export type CsvKind = 'provider-productivity' | 'appointments-timeline';

const CSV_NAMES: Record<string, string> = {
  'provider-productivity': 'nang-suat-bac-si.csv',
  'appointments-timeline': 'lich-hen-theo-ngay.csv',
};

/** Tải file CSV (giữ Authorization header — không mở URL trực tiếp được). */
export async function exportReportCsv(kind: CsvKind, from?: string, to?: string) {
  const res = await apiClient.get(`/reports/export/${kind}.csv`, {
    params: rangeParams(from, to),
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = CSV_NAMES[kind] ?? 'bao-cao.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const APPOINTMENT_STATUS_VI: Record<string, string> = {
  scheduled: 'Đã đặt',
  confirmed: 'Đã xác nhận',
  checked_in: 'Đã đến',
  in_progress: 'Đang khám',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
  no_show: 'Không đến',
};
