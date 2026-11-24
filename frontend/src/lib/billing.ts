import { apiClient } from './api-client';

export const vnd = (n: number) => n.toLocaleString('vi-VN') + ' ₫';

export const ORDER_STATUS_VI: Record<string, string> = {
  draft: 'Nháp',
  unpaid: 'Chưa thu',
  partial: 'Thu một phần',
  paid: 'Đã thanh toán',
  cancelled: 'Đã huỷ',
};
export const ORDER_STATUS_TONE: Record<string, 'neutral' | 'ok' | 'warn' | 'danger'> = {
  draft: 'neutral',
  unpaid: 'danger',
  partial: 'warn',
  paid: 'ok',
  cancelled: 'neutral',
};
export const METHOD_VI: Record<string, string> = {
  cash: 'Tiền mặt',
  transfer: 'Chuyển khoản',
  card: 'Thẻ',
  prepaid: 'Thẻ trả trước',
  other: 'Khác',
};
export const METHODS = ['cash', 'transfer', 'card', 'other'] as const;

export interface CatalogService { id: string; name: string; category: string | null; priceVnd: number }
export interface CatalogPackage { id: string; name: string; unit: string; qty: number; priceVnd: number; validityDays: number | null }
export interface Catalog { services: CatalogService[]; packages: CatalogPackage[] }

export interface OrderLine { id: string; kind: string; name: string; qty: number; unitPriceVnd: number; discountVnd: number; amountVnd: number }
export interface OrderPayment { id: string; method: string; amountVnd: number; paidAt: string }
export interface Order {
  id: string; code: string; patientId: string; patientMrn?: string; status: string;
  totalVnd: number; paidVnd: number; remainingVnd: number; note: string | null; createdAt: string;
  lines: OrderLine[]; payments: OrderPayment[];
}
export type OrderSummary = Omit<Order, 'lines' | 'payments'>;

export async function fetchCatalog(): Promise<Catalog> {
  const { data } = await apiClient.get<Catalog>('/billing/catalog');
  return data;
}
export async function createOrder(patientId: string, note?: string): Promise<Order> {
  const { data } = await apiClient.post<Order>('/billing/orders', { patientId, note });
  return data;
}
export async function getOrder(id: string): Promise<Order> {
  const { data } = await apiClient.get<Order>(`/billing/orders/${id}`);
  return data;
}
export async function addLine(
  id: string,
  body: { serviceId?: string; packageId?: string; name?: string; unitPriceVnd?: number; qty?: number; discountVnd?: number },
): Promise<Order> {
  const { data } = await apiClient.post<Order>(`/billing/orders/${id}/lines`, body);
  return data;
}
export async function removeLine(id: string, lineId: string): Promise<Order> {
  const { data } = await apiClient.delete<Order>(`/billing/orders/${id}/lines/${lineId}`);
  return data;
}
export async function takePayment(id: string, method: string, amountVnd: number): Promise<Order> {
  const { data } = await apiClient.post<Order>(`/billing/orders/${id}/payments`, { method, amountVnd });
  return data;
}
export async function cancelOrder(id: string): Promise<void> {
  await apiClient.post(`/billing/orders/${id}/cancel`);
}
export async function fetchPatientOrders(patientId: string): Promise<Order[]> {
  const { data } = await apiClient.get<Order[]>(`/billing/patients/${patientId}/orders`);
  return data;
}
export async function fetchOrders(params: { status?: string; q?: string } = {}): Promise<OrderSummary[]> {
  const { data } = await apiClient.get<OrderSummary[]>('/billing/orders', { params });
  return data;
}
export async function fetchReceivables(): Promise<{ total: number; count: number; items: OrderSummary[] }> {
  const { data } = await apiClient.get('/billing/orders/receivables');
  return data;
}
