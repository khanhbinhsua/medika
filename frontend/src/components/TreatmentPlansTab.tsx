import { useQuery } from '@tanstack/react-query';
import { listPlans, PLAN_STATUS_VI, formatVnd, type TreatmentPlanStatus } from '../lib/treatment';
import { getErrorMessage } from '../lib/api-client';
import { Alert, Badge, Skeleton } from './ui';

const TONE: Record<TreatmentPlanStatus, 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'> = {
  draft: 'neutral', pending_approval: 'warn', active: 'accent', completed: 'ok', cancelled: 'danger',
};

/** Phác đồ điều trị của bệnh nhân (chỉ đọc — quản lý đầy đủ ở trang Phác đồ). */
export function TreatmentPlansTab({ patientId }: { patientId: string }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['treatment-plans', patientId],
    queryFn: () => listPlans(patientId),
  });

  if (isError) return <Alert>{getErrorMessage(error)}</Alert>;
  if (isPending) return <Skeleton className="h-20 w-full" />;
  if (!data || data.length === 0) return <p className="py-8 text-center text-sm text-ink-soft">Chưa có phác đồ điều trị.</p>;

  return (
    <ul className="space-y-2">
      {data.map((p) => (
        <li key={p.id} className="plate p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-ink">{p.title}</span>
            <Badge tone={TONE[p.status] ?? 'neutral'}>{PLAN_STATUS_VI[p.status] ?? p.status}</Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-soft">
            <span className="tabular">Tiến độ: {p.progress.completed}/{p.progress.total} ({p.progress.percent}%)</span>
            <span className="tabular">Chi phí: {formatVnd(p.totalCost)}</span>
            <span>BS: {p.doctorName}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
