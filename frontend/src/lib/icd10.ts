import { apiClient } from './api-client';

export interface Icd10Item {
  code: string;
  name: string;
}

export async function searchIcd10(q: string): Promise<Icd10Item[]> {
  const query = q.trim();
  if (!query) return [];
  const { data } = await apiClient.get<Icd10Item[]>('/icd10/search', { params: { q: query } });
  return data;
}
