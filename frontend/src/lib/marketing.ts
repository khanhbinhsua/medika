import { apiClient } from './api-client';

export interface SegmentCriteria {
  gender?: string;
  minVisits?: number;
  maxVisits?: number;
  conditionLike?: string;
  inactiveSinceDays?: number;
  newWithinDays?: number;
  minTotalSpend?: number;
  maxTotalSpend?: number;
}

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  criteria: SegmentCriteria;
  active: boolean;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  segmentId: string | null;
  kind: string;
  message: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface CampaignReport {
  campaignId: string;
  name: string;
  total: number;
  delivered: number;
  read: number;
  failed: number;
  deliveryRate: number;
  readRate: number;
}

export interface SendResult {
  campaignId: string;
  eligible: number;
  sent: number;
  failed: number;
  skippedNoConsent: number;
}

export interface Retention {
  totalPatients: number;
  visited: number;
  returned: number;
  retentionRate: number;
}

export const CAMPAIGN_STATUS_VI: Record<Campaign['status'], string> = {
  draft: 'Nháp',
  scheduled: 'Đã lên lịch',
  sending: 'Đang gửi',
  sent: 'Đã gửi',
  cancelled: 'Đã huỷ',
};

export async function listSegments(): Promise<Segment[]> {
  const { data } = await apiClient.get<Segment[]>('/marketing/segments');
  return data;
}
export async function createSegment(input: { name: string; description?: string; criteria: SegmentCriteria }): Promise<Segment> {
  const { data } = await apiClient.post<Segment>('/marketing/segments', input);
  return data;
}
export async function deleteSegment(id: string): Promise<void> {
  await apiClient.delete(`/marketing/segments/${id}`);
}
export async function previewCriteria(criteria: SegmentCriteria): Promise<{ count: number; sample: { patientId: string; mrn: string }[] }> {
  const { data } = await apiClient.post('/marketing/segments/preview', { criteria });
  return data;
}
export async function previewSegment(id: string): Promise<{ count: number; sample: { patientId: string; mrn: string }[] }> {
  const { data } = await apiClient.get(`/marketing/segments/${id}/preview`);
  return data;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const { data } = await apiClient.get<Campaign[]>('/marketing/campaigns');
  return data;
}
export async function createCampaign(input: {
  name: string;
  segmentId: string;
  message: string;
  kind?: 'marketing' | 'treatment_next';
}): Promise<Campaign> {
  const { data } = await apiClient.post<Campaign>('/marketing/campaigns', input);
  return data;
}
export async function sendCampaign(id: string): Promise<SendResult> {
  const { data } = await apiClient.post<SendResult>(`/marketing/campaigns/${id}/send`);
  return data;
}
export async function campaignReport(id: string): Promise<CampaignReport> {
  const { data } = await apiClient.get<CampaignReport>(`/marketing/campaigns/${id}/report`);
  return data;
}

export async function dispatchBirthday(message: string): Promise<{ scanned: number; matched: number; sent: number; skippedNoConsent: number }> {
  const { data } = await apiClient.post('/marketing/birthday/dispatch', { message });
  return data;
}
export async function dispatchCare(): Promise<{ processed: number; sent: number; failed: number }> {
  const { data } = await apiClient.post('/marketing/care/dispatch');
  return data;
}
export async function retention(): Promise<Retention> {
  const { data } = await apiClient.get<Retention>('/marketing/reports/retention');
  return data;
}
