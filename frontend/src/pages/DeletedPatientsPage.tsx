import { useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { fetchDeletedPatients } from '../lib/patients';
import type { DeletedPatient } from '../lib/patients';
import { getErrorMessage } from '../lib/api-client';
import { Button, Alert, Badge, Skeleton } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { PurgePatientDialog } from '../components/PurgePatientDialog';

const PAGE_SIZE = 20;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DeletedPatientsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [purging, setPurging] = useState<DeletedPatient | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['patients-deleted', page],
    queryFn: () => fetchDeletedPatients({ page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['patients-deleted'] });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Hồ sơ đã xoá"
        eyebrow="Quản trị"
        meta={data ? `${data.pagination.total} hồ sơ` : undefined}
      />

      <div className="plate bg-surface-sunk p-4">
        <p className="text-xs leading-relaxed text-ink-faint">
          Hồ sơ đã xoá (soft-delete) không hiện ở bất kỳ danh sách nào khác. Tiêu huỷ vĩnh viễn
          (crypto-shredding) chỉ khả dụng sau một thời gian ân hạn kể từ lúc xoá, và{' '}
          <span className="text-ink-soft">không thể hoàn tác</span>.
        </p>
      </div>

      {isError && <Alert>{getErrorMessage(error)}</Alert>}

      <div className="plate overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule bg-surface-sunk text-left">
                <th className="field-label px-3 py-2.5 w-32">Mã hồ sơ</th>
                <th className="field-label px-3 py-2.5">Tên</th>
                <th className="field-label px-3 py-2.5 w-40">Đã xoá lúc</th>
                <th className="field-label px-3 py-2.5 w-36">Trạng thái</th>
                <th className="field-label px-3 py-2.5 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-rule last:border-0">
                    <td colSpan={5} className="px-3 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))
              ) : data && data.data.length > 0 ? (
                data.data.map((p) => <Row key={p.id} patient={p} onPurgeClick={() => setPurging(p)} />)
              ) : (
                <tr>
                  <td colSpan={5} className="px-3 py-16 text-center text-sm text-ink-soft">
                    Không có hồ sơ nào đã xoá.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {data && data.pagination.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-rule px-3 py-2.5">
            <span className="tabular text-xs text-ink-faint">
              Trang {data.pagination.page} / {data.pagination.totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" className="h-8 px-3 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Trước
              </Button>
              <Button
                variant="ghost"
                className="h-8 px-3 text-xs"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Sau
              </Button>
            </div>
          </div>
        )}
      </div>

      {purging && (
        <PurgePatientDialog
          patient={purging}
          onClose={() => setPurging(null)}
          onPurged={() => {
            setPurging(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function Row({ patient: p, onPurgeClick }: { patient: DeletedPatient; onPurgeClick: () => void }) {
  const isPurged = !!p.purgedAt;

  return (
    <tr className="border-b border-rule last:border-0">
      <td className="tabular px-3 py-2.5 text-ink-soft">{p.mrn}</td>
      <td className="px-3 py-2.5">
        <span className={isPurged ? 'italic text-ink-faint' : 'text-ink'}>{p.displayName}</span>
        {isPurged && p.purgedReason && (
          <div className="mt-0.5 text-xs text-ink-faint">Lý do: {p.purgedReason}</div>
        )}
      </td>
      <td className="tabular px-3 py-2.5 text-xs text-ink-soft">{formatDateTime(p.deletedAt)}</td>
      <td className="px-3 py-2.5">
        {isPurged ? (
          <div>
            <Badge tone="danger">Đã tiêu huỷ</Badge>
            {p.purgedByName && <div className="mt-0.5 text-[11px] text-ink-faint">bởi {p.purgedByName}</div>}
          </div>
        ) : p.isPurgeEligible ? (
          <Badge tone="warn">Đủ điều kiện tiêu huỷ</Badge>
        ) : (
          <Badge>Trong thời gian ân hạn</Badge>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {!isPurged && p.isPurgeEligible && (
          <Button variant="danger" className="h-7 px-2.5 text-xs" onClick={onPurgeClick}>
            Tiêu huỷ
          </Button>
        )}
      </td>
    </tr>
  );
}
