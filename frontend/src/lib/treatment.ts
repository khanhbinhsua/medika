import { apiClient } from './api-client';

export type TreatmentPlanStatus = 'draft' | 'pending_approval' | 'active' | 'completed' | 'cancelled';
export type TreatmentStepStatus = 'pending' | 'scheduled' | 'completed' | 'skipped' | 'cancelled';

export interface TreatmentStep {
  id: string;
  stepOrder: number;
  title: string;
  description: string | null;
  cost: number;
  status: TreatmentStepStatus;
  scheduledDate: string | null;
  completedAt: string | null;
  appointmentId: string | null;
}

export interface TreatmentPlan {
  id: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  doctorId: string;
  doctorName: string;
  templateId: string | null;
  title: string;
  status: TreatmentPlanStatus;
  totalCost: number;
  progress: { completed: number; total: number; percent: number };
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  steps: TreatmentStep[];
}

export interface TreatmentTemplate {
  id: string;
  code: string;
  name: string;
  condition: string | null;
  description: string | null;
  active: boolean;
  steps: { stepOrder: number; title: string; description: string | null; estimatedCost: number }[];
}

export interface PlanHistoryEntry {
  action: string;
  actor: string | null;
  detail: string | null;
  at: string;
}

export const PLAN_STATUS_VI: Record<TreatmentPlanStatus, string> = {
  draft: 'Nháp',
  pending_approval: 'Chờ duyệt',
  active: 'Đang điều trị',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

export const STEP_STATUS_VI: Record<TreatmentStepStatus, string> = {
  pending: 'Chờ thực hiện',
  scheduled: 'Đã lên lịch',
  completed: 'Hoàn thành',
  skipped: 'Bỏ qua',
  cancelled: 'Đã huỷ',
};

export async function listPlans(patientId: string): Promise<TreatmentPlan[]> {
  const { data } = await apiClient.get<TreatmentPlan[]>('/treatment-plans', { params: { patientId } });
  return data;
}

export async function getPlan(id: string): Promise<TreatmentPlan> {
  const { data } = await apiClient.get<TreatmentPlan>(`/treatment-plans/${id}`);
  return data;
}

export interface CreatePlanInput {
  patientId: string;
  doctorId: string;
  title: string;
  steps?: { title: string; description?: string; cost?: number }[];
}

export async function createPlan(input: CreatePlanInput): Promise<TreatmentPlan> {
  const { data } = await apiClient.post<TreatmentPlan>('/treatment-plans', input);
  return data;
}

export async function createFromTemplate(input: {
  patientId: string;
  doctorId: string;
  templateId: string;
  title?: string;
}): Promise<TreatmentPlan> {
  const { data } = await apiClient.post<TreatmentPlan>('/treatment-plans/from-template', input);
  return data;
}

export async function addStep(
  planId: string,
  input: { title: string; description?: string; cost?: number },
): Promise<TreatmentPlan> {
  const { data } = await apiClient.post<TreatmentPlan>(`/treatment-plans/${planId}/steps`, input);
  return data;
}

export async function updateStep(
  planId: string,
  stepId: string,
  input: { status?: TreatmentStepStatus; cost?: number; scheduledDate?: string | null; appointmentId?: string | null },
): Promise<TreatmentPlan> {
  const { data } = await apiClient.patch<TreatmentPlan>(`/treatment-plans/${planId}/steps/${stepId}`, input);
  return data;
}

export async function submitPlan(planId: string): Promise<TreatmentPlan> {
  const { data } = await apiClient.post<TreatmentPlan>(`/treatment-plans/${planId}/submit`);
  return data;
}

export async function approvePlan(planId: string): Promise<TreatmentPlan> {
  const { data } = await apiClient.post<TreatmentPlan>(`/treatment-plans/${planId}/approve`);
  return data;
}

export async function cancelPlan(planId: string, reason: string): Promise<TreatmentPlan> {
  const { data } = await apiClient.post<TreatmentPlan>(`/treatment-plans/${planId}/cancel`, { reason });
  return data;
}

export async function listTemplates(): Promise<TreatmentTemplate[]> {
  const { data } = await apiClient.get<TreatmentTemplate[]>('/treatment-plans/templates');
  return data;
}

export async function planHistory(planId: string): Promise<PlanHistoryEntry[]> {
  const { data } = await apiClient.get<PlanHistoryEntry[]>(`/treatment-plans/${planId}/history`);
  return data;
}

export function formatVnd(n: number): string {
  return n.toLocaleString('vi-VN') + ' ₫';
}
