import { apiClient } from './api-client';

export interface Vitals { pulse?: string; temp?: string; bp?: string; resp?: string; weight?: string; height?: string; spo2?: string }

export interface Encounter {
  id: string; patientId: string; doctorId: string; appointmentId: string | null; status: string;
  reason: string | null; history: string | null; pastPersonal: string | null; pastFamily: string | null;
  vitals: Vitals;
  examGeneral: string | null; examOrgans: string | null; labsSummary: string | null;
  treatment: string | null; dxNote: string | null;
  dxPrimaryIcd10: string | null; dxSecondaryIcd10: string[];
  treatmentFrom: string | null; treatmentTo: string | null;
  signedAt: string | null; locked: boolean; createdAt: string; updatedAt: string;
}
export interface EncounterSummary {
  id: string; status: string; dxPrimaryIcd10: string | null; dxName: string | null; doctorName: string; createdAt: string;
}
export interface EncounterVersion { version: number; changeReason: string; changedBy: string; createdAt: string; snapshot: Encounter }

export const ENCOUNTER_STATUS_VI: Record<string, string> = { draft: 'Nháp', signed: 'Đã ký', amended: 'Đã bổ sung' };
export const ENCOUNTER_STATUS_TONE: Record<string, 'neutral' | 'ok' | 'warn'> = { draft: 'neutral', signed: 'ok', amended: 'warn' };

export type EncounterPatch = Partial<Omit<Encounter, 'id' | 'patientId' | 'doctorId' | 'appointmentId' | 'status' | 'signedAt' | 'locked' | 'createdAt' | 'updatedAt'>>;

export async function fetchEncounters(patientId: string): Promise<EncounterSummary[]> {
  const { data } = await apiClient.get<EncounterSummary[]>(`/encounters/patients/${patientId}`);
  return data;
}
export async function getEncounter(id: string): Promise<Encounter> {
  const { data } = await apiClient.get<Encounter>(`/encounters/${id}`);
  return data;
}
export async function createEncounter(patientId: string, appointmentId?: string): Promise<Encounter> {
  const { data } = await apiClient.post<Encounter>('/encounters', { patientId, appointmentId });
  return data;
}
export async function updateEncounter(id: string, patch: EncounterPatch): Promise<Encounter> {
  const { data } = await apiClient.patch<Encounter>(`/encounters/${id}`, patch);
  return data;
}
export async function signEncounter(id: string): Promise<Encounter> {
  const { data } = await apiClient.post<Encounter>(`/encounters/${id}/sign`);
  return data;
}
export async function amendEncounter(id: string, patch: EncounterPatch & { changeReason: string }): Promise<Encounter> {
  const { data } = await apiClient.post<Encounter>(`/encounters/${id}/amend`, patch);
  return data;
}
export async function fetchEncounterVersions(id: string): Promise<EncounterVersion[]> {
  const { data } = await apiClient.get<EncounterVersion[]>(`/encounters/${id}/versions`);
  return data;
}
