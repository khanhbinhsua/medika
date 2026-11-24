import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchPatients } from '../lib/patients';
import { useAuthStore, ROLE_LABELS } from '../stores/auth.store';
import { PageHeader } from '../components/PageHeader';
import { Badge, Skeleton } from '../components/ui';

export function DashboardPage() {
  const { user, can } = useAuthStore();

  const patients = useQuery({
    queryKey: ['patients', 1, ''],
    queryFn: () => fetchPatients({ page: 1, pageSize: 5 }),
    enabled: can('patient:read'),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        eyebrow={ROLE_LABELS[user?.role ?? ''] ?? user?.role}
        title={`Chào ${user?.fullName ?? ''}`}
        meta={new Date().toLocaleDateString('vi-VN', {
          weekday: 'long',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Hồ sơ bệnh nhân"
          value={can('patient:read') ? (patients.data?.pagination.total ?? null) : '—'}
          to={can('patient:read') ? '/benh-nhan' : undefined}
        />
        <Stat label="Lịch hẹn hôm nay" value="—" note="Phase 2" />
        <Stat label="Kết quả chờ duyệt" value="—" note="Phase 2" />
      </div>

      {can('patient:read') && (
        <section className="plate">
          <div className="flex items-center justify-between border-b border-rule bg-surface-sunk px-4 py-2">
            <h2 className="field-label">Hồ sơ mới nhất</h2>
            <Link to="/benh-nhan" className="text-xs text-accent hover:underline">
              Xem tất cả
            </Link>
          </div>

          {patients.isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : patients.data && patients.data.data.length > 0 ? (
            <ul>
              {patients.data.data.map((p) => (
                <li key={p.id} className="border-b border-rule last:border-0">
                  <Link
                    to={`/benh-nhan/${p.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-2.5 transition-colors duration-150 hover:bg-surface-sunk"
                  >
                    <span className="min-w-0 truncate text-sm text-ink">
                      {p.firstName} {p.lastName}
                    </span>
                    <span className="tabular shrink-0 text-xs text-ink-faint">{p.mrn}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-6 text-center text-sm text-ink-soft">Chưa có hồ sơ nào.</p>
          )}
        </section>
      )}

      <section className="plate bg-surface-sunk p-4">
        <h2 className="field-label">Quyền của tài khoản này</h2>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(user?.permissions ?? []).map((p) => (
            <Badge key={p}>{p}</Badge>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  to,
}: {
  label: string;
  value: number | string | null;
  note?: string;
  to?: string;
}) {
  const body = (
    <div className="plate h-full p-4 transition-colors duration-150 hover:border-rule-strong">
      <div className="field-label">{label}</div>
      <div className="tabular mt-2 text-2xl font-semibold tracking-tight text-ink">
        {value === null ? <Skeleton className="h-7 w-16" /> : value}
      </div>
      {note && <div className="mt-1 text-[10px] uppercase tracking-wider text-ink-faint">{note}</div>}
    </div>
  );

  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
