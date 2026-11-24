import { portalClient } from '../stores/portal.store';

export interface PortalAppointment {
  id: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  room: string | null;
  doctorName: string;
}

export interface PortalPrescription {
  id: string;
  medication: string;
  dosage: string;
  frequency: string;
  durationDays: number | null;
  instructions: string | null;
  status: string;
  prescribedAt: string;
}

export async function fetchPortalAppointments() {
  const { data } = await portalClient.get<PortalAppointment[]>('/portal/appointments');
  return data;
}

export async function fetchPortalPrescriptions() {
  const { data } = await portalClient.get<PortalPrescription[]>('/portal/prescriptions');
  return data;
}

export const APPT_STATUS_VI: Record<string, string> = {
  scheduled: 'Đã đặt',
  confirmed: 'Đã xác nhận',
  checked_in: 'Đã đến',
  in_progress: 'Đang khám',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
  no_show: 'Không đến',
};

export const ABNORMAL_VI: Record<string, string> = {
  normal: 'Bình thường',
  low: 'Thấp',
  high: 'Cao',
  critical: 'Nguy kịch',
};

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
