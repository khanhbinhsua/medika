import { useQuery } from '@tanstack/react-query';
import { fetchPatientPackages } from '../lib/billing';
import { getErrorMessage } from '../lib/api-client';
import { Alert, Badge, Skeleton } from './ui';

/** Thẻ buổi (gói) của bệnh nhân (chỉ đọc) — mua gói ở màn Thu ngân, trừ buổi khi hoàn tất lịch. */
export function PackagesTab({ patientId }: { patientId: string }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['patient-packages', patientId],
    queryFn: () => fetchPatientPackages(patientId),
  });

  if (isError) return <Alert>{getErrorMessage(error)}</Alert>;
  if (isPending) return <Skeleton className="h-20 w-full" />;
  if (!data || data.length === 0) return <p className="py-8 text-center text-sm text-ink-soft">Chưa có gói/thẻ buổi nào.</p>;

  const today = new Date().toISOString().slice(0, 10);
  return (
    <ul className="space-y-2">
      {data.map((p) => {
        const expired = p.expiresAt !== null && p.expiresAt < today;
        const used = p.remaining === 0;
        return (
          <li key={p.id} className="plate flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">{p.name}</div>
              <div className="tabular mt-0.5 text-xs text-ink-soft">
                Còn {p.remaining}/{p.total} buổi
                {p.expiresAt ? ` · hạn ${p.expiresAt}` : ''}
              </div>
            </div>
            {expired ? (
              <Badge tone="danger">Hết hạn</Badge>
            ) : used ? (
              <Badge tone="neutral">Hết buổi</Badge>
            ) : (
              <Badge tone="ok">Còn {p.remaining}</Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
}
