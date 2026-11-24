import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePortalStore } from '../../stores/portal.store';
import {
  fetchPortalAppointments,
  fetchPortalPrescriptions,
  APPT_STATUS_VI,
  fmtDateTime,
  fmtDate,
} from '../../lib/portal';
import { getErrorMessage } from '../../lib/api-client';
import { Badge, Alert, Skeleton, cx } from '../../components/ui';

type Tab = 'appointments' | 'prescriptions';

export function PortalDashboard() {
  const navigate = useNavigate();
  const { patient, logout } = usePortalStore();
  const [tab, setTab] = useState<Tab>('appointments');

  async function onLogout() {
    await logout();
    navigate('/portal/login', { replace: true });
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'appointments', label: 'Lịch hẹn' },
    { id: 'prescriptions', label: 'Đơn thuốc' },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-rule bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
              <rect x="0.5" y="0.5" width="23" height="23" rx="4" fill="none" stroke="rgb(var(--rule-strong))" />
              <path d="M12 5.5v13M5.5 12h13" stroke="rgb(var(--accent))" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-semibold tracking-tight">Cổng bệnh nhân</span>
          </div>
          <button onClick={() => void onLogout()} className="rounded border border-rule-strong px-2.5 py-1.5 text-xs text-ink-soft hover:bg-surface-sunk hover:text-ink">
            Đăng xuất
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <section className="plate p-4">
          <div className="field-label">Xin chào</div>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-ink">{patient?.fullName}</h1>
          <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-ink-soft sm:grid-cols-3">
            <div><span className="text-ink-faint">Mã hồ sơ: </span><span className="tabular">{patient?.mrn}</span></div>
            <div><span className="text-ink-faint">Ngày sinh: </span><span className="tabular">{patient?.dob ? fmtDate(patient.dob) : '—'}</span></div>
            <div className="truncate"><span className="text-ink-faint">Điện thoại: </span><span className="tabular">{patient?.phone ?? '—'}</span></div>
          </div>
        </section>

        <div className="mt-5 flex overflow-x-auto border-b border-rule" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx('relative whitespace-nowrap px-4 py-2.5 text-sm transition-colors', tab === t.id ? 'font-medium text-ink' : 'text-ink-soft hover:text-ink')}
            >
              {t.label}
              <span className={cx('absolute inset-x-2 -bottom-px h-0.5 transition-opacity', tab === t.id ? 'bg-accent opacity-100' : 'opacity-0')} />
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === 'appointments' && <AppointmentsTab />}
          {tab === 'prescriptions' && <PrescriptionsTab />}
        </div>
      </main>

      <footer className="border-t border-rule px-4 py-3">
        <p className="mx-auto max-w-3xl text-[10px] uppercase tracking-[0.12em] text-ink-faint">
          Dữ liệu của bạn được mã hoá và bảo mật
        </p>
      </footer>
    </div>
  );
}

function AppointmentsTab() {
  const { data, isPending, isError, error } = useQuery({ queryKey: ['portal-appts'], queryFn: fetchPortalAppointments });
  if (isError) return <Alert>{getErrorMessage(error)}</Alert>;
  if (isPending) return <Skeleton className="h-24 w-full" />;
  if (data.length === 0) return <Empty text="Bạn chưa có lịch hẹn nào." />;
  return (
    <ul className="space-y-2">
      {data.map((a) => (
        <li key={a.id} className="plate p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="tabular text-sm font-medium text-ink">{fmtDateTime(a.scheduledStart)}</span>
            <Badge tone={a.status === 'completed' ? 'ok' : a.status === 'cancelled' || a.status === 'no_show' ? 'danger' : 'accent'}>
              {APPT_STATUS_VI[a.status] ?? a.status}
            </Badge>
          </div>
          <div className="mt-1 text-sm text-ink-soft">
            {a.doctorName}
            {a.room ? ` · ${a.room}` : ''}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PrescriptionsTab() {
  const { data, isPending, isError, error } = useQuery({ queryKey: ['portal-rx'], queryFn: fetchPortalPrescriptions });
  if (isError) return <Alert>{getErrorMessage(error)}</Alert>;
  if (isPending) return <Skeleton className="h-24 w-full" />;
  if (data.length === 0) return <Empty text="Bạn chưa có đơn thuốc nào." />;
  return (
    <ul className="space-y-2">
      {data.map((p) => (
        <li key={p.id} className="plate p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">{p.medication}</span>
            <Badge tone={p.status === 'active' ? 'ok' : 'neutral'}>{p.status === 'active' ? 'Đang dùng' : p.status}</Badge>
          </div>
          <div className="tabular mt-1 text-xs text-ink-soft">
            {p.dosage} · {p.frequency}
            {p.durationDays ? ` · ${p.durationDays} ngày` : ''}
          </div>
          {p.instructions && <p className="mt-1.5 text-xs text-ink-soft">{p.instructions}</p>}
          <div className="tabular mt-1.5 text-[10px] uppercase tracking-wider text-ink-faint">{fmtDateTime(p.prescribedAt)}</div>
        </li>
      ))}
    </ul>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="plate border-dashed p-10 text-center">
      <p className="text-sm text-ink-soft">{text}</p>
    </div>
  );
}
