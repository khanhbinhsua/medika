import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  fetchAppointments,
  fetchAppointmentCounts,
  changeAppointmentStatus,
  cancelAppointment,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_SOURCE_LABELS,
  NEXT_STATUSES,
  formatTimeRange,
  statusTone,
} from '../lib/clinical';
import type { Appointment, AppointmentStatus } from '../lib/clinical';
import { fetchDoctors } from '../lib/booking';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Alert, Badge, Skeleton, Input, cx } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { NewAppointmentDialog } from '../components/NewAppointmentDialog';
import { AppointmentsCalendar } from '../components/AppointmentsCalendar';
import { AppointmentsBoard } from '../components/AppointmentsBoard';
import { ReminderStatus } from '../components/ReminderStatus';

const PAGE_SIZE = 20;
type ViewMode = 'list' | 'calendar' | 'board';
const VIEW_LABELS: Record<ViewMode, string> = { list: 'Danh sách', calendar: 'Lịch', board: 'Bảng' };

function todayRange(dayOffset: number) {
  const start = new Date();
  start.setDate(start.getDate() + dayOffset);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function AppointmentsPage() {
  const can = useAuthStore((s) => s.can);
  const queryClient = useQueryClient();

  const [view, setView] = useState<ViewMode>('list');
  const [dayOffset, setDayOffset] = useState(0);
  const [allDates, setAllDates] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<AppointmentStatus | ''>('');
  const [doctorId, setDoctorId] = useState('');
  const [source, setSource] = useState('');
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);

  const resetPage = () => setPage(1);

  const range = todayRange(dayOffset);
  const dateRange = allDates ? {} : { from: range.from, to: range.to };
  const filters = {
    ...(doctorId ? { doctorId } : {}),
    ...(source ? { source } : {}),
  };
  const params = { page, pageSize: PAGE_SIZE, ...dateRange, ...filters, ...(status ? { status } : {}) };
  const countsParams = { ...dateRange, ...filters };

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['appointments', params],
    queryFn: () => fetchAppointments(params),
    placeholderData: keepPreviousData,
    enabled: view === 'list',
  });

  const counts = useQuery({
    queryKey: ['appointment-counts', countsParams],
    queryFn: () => fetchAppointmentCounts(countsParams),
    placeholderData: keepPreviousData,
    enabled: view === 'list',
  });

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: fetchDoctors });

  const STATUS_FILTERS: Array<AppointmentStatus | ''> = [
    '', 'scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show',
  ];
  const countFor = (s: AppointmentStatus | '') =>
    s === '' ? counts.data?.total ?? 0 : counts.data?.byStatus[s] ?? 0;

  // Làm mới mọi khung nhìn lịch hẹn (danh sách/lịch/bảng/đếm) sau khi đổi trạng thái.
  const invalidate = () =>
    void queryClient.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('appointment'),
    });

  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AppointmentStatus }) =>
      changeAppointmentStatus(id, status),
    onSuccess: (updated) => {
      toast.success(`Đã chuyển sang "${APPOINTMENT_STATUS_LABELS[updated.status]}"`);
      invalidate();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const heading = allDates
    ? 'Tất cả lịch hẹn'
    : new Date(range.from).toLocaleDateString('vi-VN', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Lịch hẹn"
        meta={view === 'list' && data ? `${data.pagination.total} lịch` : undefined}
        action={
          can('appointment:write') ? <Button onClick={() => setCreating(true)}>Đặt lịch</Button> : undefined
        }
      />

      {/* Chọn chế độ xem */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cx(
              'rounded-md border px-3 py-1 text-xs font-medium',
              view === v ? 'border-accent text-accent' : 'border-rule-strong text-ink-soft hover:bg-surface-sunk',
            )}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {view !== 'calendar' && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className="h-9 px-3 text-xs"
            disabled={allDates}
            onClick={() => {
              setDayOffset((d) => d - 1);
              setPage(1);
            }}
          >
            ← Hôm trước
          </Button>
          <Button
            variant="ghost"
            className="h-9 px-3 text-xs"
            disabled={allDates}
            onClick={() => {
              setDayOffset(0);
              setPage(1);
            }}
          >
            Hôm nay
          </Button>
          <Button
            variant="ghost"
            className="h-9 px-3 text-xs"
            disabled={allDates}
            onClick={() => {
              setDayOffset((d) => d + 1);
              setPage(1);
            }}
          >
            Hôm sau →
          </Button>
        </div>
        )}

        {view === 'list' && (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={allDates}
            onChange={(e) => {
              setAllDates(e.target.checked);
              setPage(1);
            }}
            className="h-3.5 w-3.5 accent-[rgb(var(--accent))]"
          />
          Xem mọi ngày
        </label>
        )}

        {/* Lọc theo bác sĩ / nguồn */}
        <select
          value={doctorId}
          onChange={(e) => { setDoctorId(e.target.value); resetPage(); }}
          className="ml-auto h-9 rounded-md border border-rule-strong bg-surface px-2 text-xs text-ink"
        >
          <option value="">Mọi bác sĩ</option>
          {doctors.data?.map((d) => (
            <option key={d.id} value={d.id}>{d.fullName}</option>
          ))}
        </select>
        <select
          value={source}
          onChange={(e) => { setSource(e.target.value); resetPage(); }}
          className="h-9 rounded-md border border-rule-strong bg-surface px-2 text-xs text-ink"
        >
          <option value="">Mọi nguồn</option>
          {Object.entries(APPOINTMENT_SOURCE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </div>

      {/* Chip trạng thái kèm số đếm */}
      {view === 'list' && (
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => { setStatus(s); resetPage(); }}
            className={cx(
              'rounded-md border px-2.5 py-1 text-xs',
              status === s ? 'border-accent text-accent' : 'border-rule-strong text-ink-soft hover:bg-surface-sunk',
            )}
          >
            {s === '' ? 'Tất cả' : APPOINTMENT_STATUS_LABELS[s]}
            <span className="tabular ml-1 text-ink-faint">{countFor(s)}</span>
          </button>
        ))}
      </div>
      )}

      {view !== 'calendar' && <h2 className="text-sm font-medium text-ink">{heading}</h2>}

      {view === 'list' && (
      <>
      {isError && <Alert>{getErrorMessage(error)}</Alert>}

      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : data && data.data.length > 0 ? (
        <ul className="space-y-2">
          {data.data.map((a) => (
            <AppointmentCard
              key={a.id}
              appointment={a}
              canWrite={can('appointment:write')}
              canCancel={can('appointment:cancel')}
              busy={transition.isPending}
              onTransition={(status) => transition.mutate({ id: a.id, status })}
              onCancel={() => setCancelling(a)}
            />
          ))}
        </ul>
      ) : (
        <div className="plate border-dashed p-12 text-center">
          <p className="text-sm text-ink-soft">Không có lịch hẹn nào trong khoảng thời gian này.</p>
        </div>
      )}

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3">
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
      </>
      )}

      {view === 'calendar' && (
        <AppointmentsCalendar doctorId={doctorId || undefined} source={source || undefined} />
      )}

      {view === 'board' && (
        <AppointmentsBoard
          from={range.from}
          to={range.to}
          doctorId={doctorId || undefined}
          source={source || undefined}
          canWrite={can('appointment:write')}
          canCancel={can('appointment:cancel')}
          busy={transition.isPending}
          onTransition={(id, status) => transition.mutate({ id, status })}
          onCancel={(a) => setCancelling(a)}
        />
      )}

      {creating && (
        <NewAppointmentDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}

      {cancelling && (
        <CancelDialog
          appointment={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={() => {
            setCancelling(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function AppointmentCard({
  appointment: a,
  canWrite,
  canCancel,
  busy,
  onTransition,
  onCancel,
}: {
  appointment: Appointment;
  canWrite: boolean;
  canCancel: boolean;
  busy: boolean;
  onTransition: (status: AppointmentStatus) => void;
  onCancel: () => void;
}) {
  const next = NEXT_STATUSES[a.status];
  const closed = a.status === 'cancelled' || a.status === 'completed' || a.status === 'no_show';

  return (
    <li className="plate p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-sm font-semibold text-ink">
              {formatTimeRange(a.scheduledStart, a.scheduledEnd)}
            </span>
            <Badge tone={statusTone(a.status)}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
            {a.room && <span className="tabular text-xs text-ink-faint">{a.room}</span>}
          </div>

          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <Link to={`/benh-nhan/${a.patientId}`} className="text-sm font-medium text-ink hover:underline">
              {a.patientName}
            </Link>
            <span className="tabular text-xs text-ink-faint">{a.patientMrn}</span>
          </div>

          <div className="mt-0.5 text-xs text-ink-soft">{a.doctorName}</div>

          {a.reason && <p className="mt-2 text-sm leading-relaxed text-ink-soft">{a.reason}</p>}
          {a.cancelReason && (
            <p className="mt-2 text-sm text-danger">Lý do huỷ: {a.cancelReason}</p>
          )}

          <ReminderStatus appointmentId={a.id} />
        </div>

        {!closed && (canWrite || canCancel) && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {canWrite &&
              next.map((s) => (
                <Button
                  key={s}
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  disabled={busy}
                  onClick={() => onTransition(s)}
                >
                  {APPOINTMENT_STATUS_LABELS[s]}
                </Button>
              ))}
            {canCancel && (
              <Button variant="danger" className="h-8 px-3 text-xs" onClick={onCancel}>
                Huỷ
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function CancelDialog({
  appointment,
  onClose,
  onCancelled,
}: {
  appointment: Appointment;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => cancelAppointment(appointment.id, reason.trim()),
    onSuccess: () => {
      toast.success('Đã huỷ lịch hẹn');
      onCancelled();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        className="plate rise w-full max-w-md p-5"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <h2 className="text-base font-semibold tracking-tight">Huỷ lịch hẹn</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {appointment.patientName} · {formatTimeRange(appointment.scheduledStart, appointment.scheduledEnd)}
        </p>

        <div className="mt-4">
          <span className="field-label">Lý do huỷ *</span>
          <div className="mt-1.5">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: bệnh nhân báo bận"
              autoFocus
              required
            />
          </div>
          {/* Lý do huỷ được mã hoá vì có thể chứa thông tin sức khoẻ */}
          <p className="mt-1.5 text-xs text-ink-faint">Lý do được lưu mã hoá cùng hồ sơ bệnh nhân.</p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Quay lại
          </Button>
          <Button type="submit" variant="danger" loading={mutation.isPending} disabled={!reason.trim()}>
            Xác nhận huỷ
          </Button>
        </div>
      </form>
    </div>
  );
}
