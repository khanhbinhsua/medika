import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { fetchPatients, fullName, ageFrom, formatDate, GENDER_LABELS, STATUS_LABELS } from '../lib/patients';
import type { Patient } from '../lib/patients';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Input, Alert, Badge, Skeleton } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { NewPatientDialog } from '../components/NewPatientDialog';

const PAGE_SIZE = 20;

export function PatientsPage() {
  const can = useAuthStore((s) => s.can);
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['patients', page, query],
    queryFn: () => fetchPatients({ page, pageSize: PAGE_SIZE, ...(query ? { q: query } : {}) }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Bệnh nhân"
        meta={data ? `${data.pagination.total} hồ sơ` : undefined}
        action={
          can('patient:purge') || can('patient:write') ? (
            <div className="flex gap-2">
              {can('patient:purge') && (
                <Link to="/benh-nhan/da-xoa">
                  <Button variant="ghost">Đã xoá</Button>
                </Link>
              )}
              {can('patient:write') && <Button onClick={() => setCreating(true)}>Thêm bệnh nhân</Button>}
            </div>
          ) : undefined
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(term.trim());
        }}
        className="flex flex-wrap gap-2"
      >
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Tìm theo họ tên, email hoặc số điện thoại"
          className="max-w-md flex-1"
          aria-label="Tìm kiếm bệnh nhân"
        />
        <Button type="submit" variant="ghost">
          Tìm
        </Button>
        {query && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setTerm('');
              setQuery('');
              setPage(1);
            }}
          >
            Xoá lọc
          </Button>
        )}
      </form>

      {/* Dữ liệu mã hoá nên chỉ khớp chính xác — nói rõ để người dùng không tưởng là lỗi */}
      {query && (
        <p className="text-xs text-ink-faint">
          Tìm kiếm trên dữ liệu đã mã hoá chỉ khớp <span className="text-ink-soft">chính xác</span> toàn bộ họ tên,
          email hoặc số điện thoại.
        </p>
      )}

      {isError && (
        <Alert>
          {getErrorMessage(error)}{' '}
          <button onClick={() => void refetch()} className="underline">
            Thử lại
          </button>
        </Alert>
      )}

      <div className="plate overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule bg-surface-sunk text-left">
                <Th className="w-40">Mã hồ sơ</Th>
                <Th>Họ và tên</Th>
                <Th className="w-32">Ngày sinh</Th>
                <Th className="w-16 text-right">Tuổi</Th>
                <Th className="w-24">Giới tính</Th>
                <Th className="w-44">Liên hệ</Th>
                <Th className="w-36">Trạng thái</Th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-rule last:border-0">
                    <td colSpan={7} className="px-3 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))
              ) : data && data.data.length > 0 ? (
                data.data.map((p) => <Row key={p.id} patient={p} />)
              ) : (
                <tr>
                  <td colSpan={7} className="px-3 py-16 text-center">
                    <p className="text-sm text-ink-soft">
                      {query ? 'Không tìm thấy hồ sơ nào khớp.' : 'Chưa có hồ sơ bệnh nhân nào.'}
                    </p>
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
              {isFetching && ' · đang tải…'}
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="h-8 px-3 text-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
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

      {creating && (
        <NewPatientDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void refetch();
          }}
        />
      )}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 field-label font-semibold ${className ?? ''}`}>{children}</th>;
}

function Row({ patient }: { patient: Patient }) {
  const age = ageFrom(patient.dob);

  return (
    <tr className="border-b border-rule transition-colors duration-150 last:border-0 hover:bg-surface-sunk">
      <td className="px-3 py-2.5">
        <Link to={`/benh-nhan/${patient.id}`} className="tabular text-accent hover:underline">
          {patient.mrn}
        </Link>
      </td>
      <td className="px-3 py-2.5">
        <Link to={`/benh-nhan/${patient.id}`} className="font-medium text-ink hover:underline">
          {fullName(patient)}
        </Link>
      </td>
      <td className="tabular px-3 py-2.5 text-ink-soft">{formatDate(patient.dob)}</td>
      <td className="tabular px-3 py-2.5 text-right text-ink-soft">{age ?? '—'}</td>
      <td className="px-3 py-2.5 text-ink-soft">{GENDER_LABELS[patient.gender ?? ''] ?? '—'}</td>
      <td className="tabular truncate px-3 py-2.5 text-ink-soft">{patient.phone ?? patient.email ?? '—'}</td>
      <td className="px-3 py-2.5">
        <Badge tone={patient.status === 'active' ? 'ok' : 'neutral'}>
          {STATUS_LABELS[patient.status] ?? patient.status}
        </Badge>
      </td>
    </tr>
  );
}
