import { apiClient } from './api-client';

export type SurveyType = 'nps' | 'csat' | 'custom';
export type SurveyStatus = 'draft' | 'active' | 'closed';

export interface SurveyQuestion {
  id: string;
  text: string;
  type: 'scale' | 'text' | 'choice';
  required?: boolean;
  min?: number;
  max?: number;
  lowLabel?: string;
  highLabel?: string;
  primary?: boolean;
  negativeAtOrBelow?: number;
  options?: string[];
}

export interface Survey {
  id: string;
  name: string;
  type: SurveyType;
  questions: SurveyQuestion[];
  status: SurveyStatus;
  createdAt: string;
}

export interface SurveyMetrics {
  total: number;
  npsScore?: number;
  promoters?: number;
  passives?: number;
  detractors?: number;
  avgScore?: number;
  satisfiedPercent?: number;
}

export interface SurveyReport {
  surveyId: string;
  name: string;
  type: SurveyType;
  totalResponses: number;
  negativeCount: number;
  overall: SurveyMetrics;
  byDoctor: ({ doctorId: string; doctorName: string } & SurveyMetrics)[];
}

export interface SurveyTrend {
  surveyId: string;
  type: SurveyType;
  trend: { month: string; count: number; avgScore: number }[];
}

export interface NegativeResponse {
  id: string;
  mrn: string;
  score: number | null;
  comment: string | null;
  doctorId: string | null;
  submittedAt: string;
}

export const SURVEY_TYPE_VI: Record<SurveyType, string> = { nps: 'NPS', csat: 'CSAT', custom: 'Tuỳ chỉnh' };
export const SURVEY_STATUS_VI: Record<SurveyStatus, string> = { draft: 'Nháp', active: 'Đang chạy', closed: 'Đã đóng' };

export async function listSurveys(): Promise<Survey[]> {
  const { data } = await apiClient.get<Survey[]>('/surveys');
  return data;
}
export async function createSurvey(input: { name: string; type: SurveyType; questions?: SurveyQuestion[] }): Promise<Survey> {
  const { data } = await apiClient.post<Survey>('/surveys', input);
  return data;
}
export async function updateSurvey(id: string, input: { status?: SurveyStatus; name?: string }): Promise<Survey> {
  const { data } = await apiClient.patch<Survey>(`/surveys/${id}`, input);
  return data;
}
export async function inviteSurvey(id: string, input: { patientId: string; doctorId?: string }): Promise<{ status: string }> {
  const { data } = await apiClient.post(`/surveys/${id}/invite`, input);
  return data;
}
export async function dispatchAuto(surveyId: string, sinceHours: number): Promise<{ candidates: number; sent: number; failed: number }> {
  const { data } = await apiClient.post('/surveys/dispatch-auto', { surveyId, sinceHours });
  return data;
}
export async function surveyReport(id: string): Promise<SurveyReport> {
  const { data } = await apiClient.get<SurveyReport>(`/surveys/${id}/report`);
  return data;
}
export async function surveyTrend(id: string): Promise<SurveyTrend> {
  const { data } = await apiClient.get<SurveyTrend>(`/surveys/${id}/trend`);
  return data;
}
export async function surveyNegative(id: string): Promise<NegativeResponse[]> {
  const { data } = await apiClient.get<NegativeResponse[]>(`/surveys/${id}/negative`);
  return data;
}
