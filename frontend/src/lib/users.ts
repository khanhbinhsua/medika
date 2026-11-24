import { apiClient } from './api-client';

export type StaffRole = 'admin' | 'doctor' | 'nurse' | 'receptionist' | 'auditor' | 'sales' | 'customer_care';
export type StaffStatus = 'active' | 'suspended' | 'disabled';

export interface StaffUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: StaffStatus;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export const ROLE_VI: Record<string, string> = {
  admin: 'Quản trị viên',
  doctor: 'Bác sĩ',
  nurse: 'Điều dưỡng',
  receptionist: 'Lễ tân',
  auditor: 'Kiểm toán',
  sales: 'Nhân viên Sale',
  customer_care: 'Chăm sóc khách hàng',
};

export const STAFF_STATUS_VI: Record<StaffStatus, string> = {
  active: 'Đang hoạt động',
  suspended: 'Tạm khoá',
  disabled: 'Vô hiệu hoá',
};

export async function listUsers(): Promise<StaffUser[]> {
  const { data } = await apiClient.get<StaffUser[]>('/users');
  return data;
}

export async function listRoles(): Promise<{ name: string; description: string }[]> {
  const { data } = await apiClient.get<{ name: string; description: string }[]>('/users/roles');
  return data;
}

export async function createUser(input: {
  email: string;
  fullName: string;
  role: StaffRole;
  password: string;
}): Promise<StaffUser> {
  const { data } = await apiClient.post<StaffUser>('/users', input);
  return data;
}

export async function updateUser(
  id: string,
  input: { fullName?: string; role?: StaffRole; status?: StaffStatus },
): Promise<StaffUser> {
  const { data } = await apiClient.patch<StaffUser>(`/users/${id}`, input);
  return data;
}

export async function resetPassword(id: string, newPassword: string): Promise<void> {
  await apiClient.post(`/users/${id}/reset-password`, { newPassword });
}

export async function resetMfa(id: string): Promise<void> {
  await apiClient.post(`/users/${id}/reset-mfa`);
}
