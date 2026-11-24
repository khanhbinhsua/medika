import { apiClient } from './api-client';

export interface Branch {
  id: string;
  code: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  slotCapacity: number | null;
  geoRadiusM: number | null;
  isDefault: boolean;
  active: boolean;
  createdAt: string;
}

export interface BranchUser {
  id: string;
  fullName: string;
  email: string;
}

export async function fetchMyBranches(): Promise<Branch[]> {
  const { data } = await apiClient.get<Branch[]>('/branches');
  return data;
}

export async function fetchAllBranches(): Promise<Branch[]> {
  const { data } = await apiClient.get<Branch[]>('/branches/all');
  return data;
}

export async function createBranch(input: {
  name: string;
  code?: string;
  address?: string;
  phone?: string;
  slotCapacity?: number;
}): Promise<Branch> {
  const { data } = await apiClient.post<Branch>('/branches', input);
  return data;
}

export async function updateBranch(id: string, input: Partial<{ name: string; address: string | null; phone: string | null; active: boolean }>): Promise<Branch> {
  const { data } = await apiClient.patch<Branch>(`/branches/${id}`, input);
  return data;
}

export async function fetchBranchUsers(branchId: string): Promise<BranchUser[]> {
  const { data } = await apiClient.get<BranchUser[]>(`/branches/${branchId}/users`);
  return data;
}

export async function assignUserToBranch(branchId: string, userId: string): Promise<void> {
  await apiClient.post(`/branches/${branchId}/users`, { userId });
}

export async function unassignUserFromBranch(branchId: string, userId: string): Promise<void> {
  await apiClient.delete(`/branches/${branchId}/users/${userId}`);
}
