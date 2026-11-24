import { apiClient } from './api-client';

export const CATEGORY_VI: Record<string, string> = {
  kham: 'Khám',
  thuoc: 'Thuốc',
  cls: 'Cận lâm sàng',
  thu_thuat: 'Thủ thuật',
  khac: 'Khác',
};
export const CATEGORIES = ['kham', 'thuoc', 'cls', 'thu_thuat', 'khac'] as const;

/** Màu badge theo hạng VIP. */
export const TIER_TONE: Record<string, 'neutral' | 'ok' | 'warn' | 'danger'> = {
  thuong: 'neutral',
  bac: 'ok',
  vang: 'warn',
  kim_cuong: 'danger',
};

export const vnd = (n: number) => n.toLocaleString('vi-VN') + ' ₫';

export interface Transaction {
  id: string;
  occurredAt: string;
  amount: number;
  category: string;
  note: string | null;
  source: string;
  createdAt: string;
}

export interface SpendingSummary {
  total: number;
  count: number;
  firstAt: string | null;
  lastAt: string | null;
  tier: { code: string; name: string };
  byMonth: { month: string; total: number }[];
  byCategory: { category: string; total: number }[];
}

export interface Tier {
  code: string;
  name: string;
  minTotal: number;
}

export interface TopSpender {
  patientId: string;
  mrn: string;
  name: string;
  total: number;
  count: number;
  lastAt: string | null;
  tier: { code: string; name: string };
}

export async function fetchSummary(patientId: string) {
  const { data } = await apiClient.get<SpendingSummary>(`/spending/patients/${patientId}/summary`);
  return data;
}

export async function fetchTransactions(patientId: string) {
  const { data } = await apiClient.get<Transaction[]>(`/spending/patients/${patientId}/transactions`);
  return data;
}

export async function addTransaction(
  patientId: string,
  body: { occurredAt: string; amount: number; category: string; note?: string },
) {
  const { data } = await apiClient.post<Transaction>(`/spending/patients/${patientId}/transactions`, body);
  return data;
}

export async function updateTransaction(
  id: string,
  body: Partial<{ occurredAt: string; amount: number; category: string; note: string | null }>,
) {
  const { data } = await apiClient.patch<Transaction>(`/spending/transactions/${id}`, body);
  return data;
}

export async function deleteTransaction(id: string) {
  await apiClient.delete(`/spending/transactions/${id}`);
}

export async function fetchTiers() {
  const { data } = await apiClient.get<Tier[]>('/spending/tiers');
  return data;
}

export async function fetchTopSpenders(params: { tier?: string; limit?: number } = {}) {
  const { data } = await apiClient.get<TopSpender[]>('/spending/top', { params });
  return data;
}

export interface ImportRow {
  mrn: string;
  occurredAt: string;
  amount: number;
  category?: string;
  note?: string;
}
export interface ImportResult {
  imported: number;
  skipped: { mrn: string; reason: string }[];
}
export async function importTransactions(rows: ImportRow[]) {
  const { data } = await apiClient.post<ImportResult>('/spending/import', { rows });
  return data;
}

/** Phân tích CSV đơn giản (mrn,occurredAt,amount,category,note). Dòng đầu là tiêu đề nếu chứa "mrn". */
export function parseCsv(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const start = /mrn/i.test(lines[0] ?? '') ? 1 : 0;
  const rows: ImportRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i] ?? '');
    const mrn = (cols[0] ?? '').trim();
    const occurredAt = (cols[1] ?? '').trim();
    const amount = Number((cols[2] ?? '').replace(/[^\d.-]/g, ''));
    if (!mrn || !occurredAt || Number.isNaN(amount)) continue;
    rows.push({
      mrn,
      occurredAt,
      amount,
      category: cols[3]?.trim() || undefined,
      note: cols[4]?.trim() || undefined,
    });
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
