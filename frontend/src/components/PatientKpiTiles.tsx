import { useQuery } from '@tanstack/react-query';
import { fetchSummary } from '../lib/spending';
import { fetchPatientOrders, fetchPatientPackages, vnd } from '../lib/billing';
import { fetchAppointments } from '../lib/clinical';

/**
 * 4 ô chỉ số trên đầu hồ sơ khách (S11 — must): chi tiêu · công nợ · buổi còn lại · lượt đến.
 * Mỗi ô một query độc lập; dữ liệu đã có sẵn từ các module spending/billing/appointments.
 */
export function PatientKpiTiles({ patientId }: { patientId: string }) {
  const spend = useQuery({ queryKey: ['kpi-spend', patientId], queryFn: () => fetchSummary(patientId) });

  const orders = useQuery({ queryKey: ['kpi-orders', patientId], queryFn: () => fetchPatientOrders(patientId) });
  const debt = (orders.data ?? [])
    .filter((o) => o.status === 'unpaid' || o.status === 'partial')
    .reduce((s, o) => s + o.remainingVnd, 0);

  const packages = useQuery({ queryKey: ['kpi-packages', patientId], queryFn: () => fetchPatientPackages(patientId) });
  const remaining = (packages.data ?? []).reduce((s, p) => s + p.remaining, 0);

  const visits = useQuery({
    queryKey: ['kpi-visits', patientId],
    queryFn: () => fetchAppointments({ patientId, status: 'completed', pageSize: 1 }),
  });

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Chi tiêu" loading={spend.isPending} value={vnd(spend.data?.total ?? 0)} />
      <Tile label="Công nợ" loading={orders.isPending} value={vnd(debt)} tone={debt > 0 ? 'danger' : undefined} />
      <Tile label="Buổi còn lại" loading={packages.isPending} value={String(remaining)} />
      <Tile label="Lượt đến" loading={visits.isPending} value={String(visits.data?.pagination.total ?? 0)} />
    </div>
  );
}

function Tile({ label, value, loading, tone }: { label: string; value: string; loading: boolean; tone?: 'danger' }) {
  return (
    <div className="plate float-1 p-3">
      <div className="field-label">{label}</div>
      <div className={`tabular mt-1 text-xl font-semibold ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}>
        {loading ? '…' : value}
      </div>
    </div>
  );
}
