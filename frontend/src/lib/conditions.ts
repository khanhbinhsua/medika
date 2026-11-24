import { apiClient } from './api-client';

export const CONDITION_STATUS_VI: Record<string, string> = {
  active: 'Đang mắc',
  chronic: 'Mạn tính',
  resolved: 'Đã khỏi',
};
export const CONDITION_STATUSES = ['active', 'chronic', 'resolved'] as const;

export const SEVERITY_VI: Record<string, string> = {
  mild: 'Nhẹ',
  moderate: 'Vừa',
  severe: 'Nặng',
  life_threatening: 'Nguy hiểm tính mạng',
};
export const SEVERITIES = ['mild', 'moderate', 'severe', 'life_threatening'] as const;

export const SEVERITY_TONE: Record<string, 'neutral' | 'ok' | 'warn' | 'danger'> = {
  mild: 'ok',
  moderate: 'warn',
  severe: 'danger',
  life_threatening: 'danger',
};
export const STATUS_TONE: Record<string, 'neutral' | 'ok' | 'warn' | 'danger'> = {
  active: 'warn',
  chronic: 'danger',
  resolved: 'ok',
};

export interface Condition {
  id: string;
  condition: string;
  icd10Code: string | null;
  status: string;
  onsetDate: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Allergy {
  id: string;
  allergyName: string;
  reaction: string | null;
  severity: string;
  notes: string | null;
  recordedAt: string;
}

export async function fetchConditions(patientId: string) {
  const { data } = await apiClient.get<{ conditions: Condition[]; allergies: Allergy[] }>(
    `/conditions/patients/${patientId}`,
  );
  return data;
}

export async function addCondition(
  patientId: string,
  body: { condition: string; icd10Code?: string; status: string; onsetDate?: string; notes?: string },
) {
  const { data } = await apiClient.post<Condition>(`/conditions/patients/${patientId}/conditions`, body);
  return data;
}

export async function updateCondition(id: string, body: Partial<{ status: string; notes: string | null }>) {
  const { data } = await apiClient.patch<Condition>(`/conditions/conditions/${id}`, body);
  return data;
}

export async function deleteCondition(id: string) {
  await apiClient.delete(`/conditions/conditions/${id}`);
}

export async function addAllergy(
  patientId: string,
  body: { allergyName: string; reaction?: string; severity: string; notes?: string },
) {
  const { data } = await apiClient.post<Allergy>(`/conditions/patients/${patientId}/allergies`, body);
  return data;
}

export async function deleteAllergy(id: string) {
  await apiClient.delete(`/conditions/allergies/${id}`);
}
