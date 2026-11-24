import { apiClient } from './api-client';

export type PhotoCategory = 'before' | 'after' | 'progress';

export interface ClinicalPhoto {
  id: string;
  patientId: string;
  encounterId: string | null;
  category: PhotoCategory;
  bodyArea: string | null;
  caption: string | null;
  takenAt: string; // YYYY-MM-DD
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  uploadedByName: string | null;
  createdAt: string;
}

export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
  before: 'Trước',
  after: 'Sau',
  progress: 'Tiến triển',
};

export async function fetchPhotos(patientId: string, encounterId?: string): Promise<ClinicalPhoto[]> {
  const { data } = await apiClient.get<ClinicalPhoto[]>('/photos', {
    params: { patientId, ...(encounterId ? { encounterId } : {}) },
  });
  return data;
}

export interface UploadPhotoInput {
  patientId: string;
  category: PhotoCategory;
  bodyArea?: string;
  caption?: string;
  takenAt?: string;
  encounterId?: string;
  file: File;
}

export async function uploadPhoto(input: UploadPhotoInput): Promise<ClinicalPhoto> {
  const form = new FormData();
  form.append('patientId', input.patientId);
  form.append('category', input.category);
  if (input.bodyArea) form.append('bodyArea', input.bodyArea);
  if (input.caption) form.append('caption', input.caption);
  if (input.takenAt) form.append('takenAt', input.takenAt);
  if (input.encounterId) form.append('encounterId', input.encounterId);
  form.append('file', input.file);
  const { data } = await apiClient.post<ClinicalPhoto>('/photos', form);
  return data;
}

/** Ảnh là PHI — tải qua blob có Authorization rồi tạo object URL (không nhúng URL trực tiếp). */
export async function fetchPhotoObjectUrl(id: string): Promise<string> {
  const res = await apiClient.get(`/photos/${id}/image`, { responseType: 'blob' });
  return URL.createObjectURL(res.data as Blob);
}

export async function deletePhoto(id: string): Promise<void> {
  await apiClient.delete(`/photos/${id}`);
}
