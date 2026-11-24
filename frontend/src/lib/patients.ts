import { apiClient } from './api-client';

export interface Patient {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dob: string;
  gender: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  insuranceId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export async function fetchPatients(params: { page: number; pageSize: number; q?: string }) {
  const { data } = await apiClient.get<Paginated<Patient>>('/patients', { params });
  return data;
}

export async function fetchPatient(id: string) {
  const { data } = await apiClient.get<Patient>(`/patients/${id}`);
  return data;
}

export async function createPatient(input: Record<string, unknown>) {
  const { data } = await apiClient.post<Patient>('/patients', input);
  return data;
}

export async function deletePatient(id: string) {
  await apiClient.delete(`/patients/${id}`);
}

export interface DeletedPatient {
  id: string;
  mrn: string;
  displayName: string;
  deletedAt: string;
  purgedAt: string | null;
  purgedByName: string | null;
  purgedReason: string | null;
  purgeEligibleAt: string;
  isPurgeEligible: boolean;
}

export async function fetchDeletedPatients(params: { page: number; pageSize: number }) {
  const { data } = await apiClient.get<Paginated<DeletedPatient>>('/patients/deleted', { params });
  return data;
}

export async function purgePatient(id: string, reason: string) {
  await apiClient.post(`/patients/${id}/purge`, { reason });
}

export const GENDER_LABELS: Record<string, string> = {
  male: 'Nam',
  female: 'Nữ',
  other: 'Khác',
  unknown: 'Không rõ',
};

export const STATUS_LABELS: Record<string, string> = {
  active: 'Đang theo dõi',
  inactive: 'Ngừng theo dõi',
  deceased: 'Đã mất',
  merged: 'Đã gộp hồ sơ',
};

export function fullName(p: Patient): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

/** Tuổi tính theo năm tròn, dùng cho cột danh sách. */
export function ageFrom(dob: string): number | null {
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const monthDiff = now.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < born.getDate())) age -= 1;
  return age;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
