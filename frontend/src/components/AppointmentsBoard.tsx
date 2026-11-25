import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  fetchAppointments,
  APPOINTMENT_STATUS_LABELS,
  NEXT_STATUSES,
  formatTimeRange,
} from '../lib/clinical';
import type { Appointment, AppointmentStatus } from '../lib/clinical';
import { Alert, Badge, Button, Skeleton, cx } from './ui';
import { getErrorMessage } from '../lib/api-client';

/** Các cột trạng thái đang hoạt động (bỏ cancelled/no_show khỏi bảng luồng). */
const COLUMNS: AppointmentStatus[] = ['scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed'];
/** Ngưỡng chờ (phút) để bật viền cảnh báo. */
const WARN_MIN = 15;

function waitMinutes(a: Appointment, now: number): number | null {
  // Đã đến mà chưa vào khám: đếm từ lúc check-in. Chưa đến mà quá giờ hẹn: đếm từ giờ hẹn.
  if (a.status === 'checked_in' && a.checkedInAt) {
    return Math.max(0, Math.floor((now - new Date(a.checkedInAt).getTime()) / 60_000));
  }
  if ((a.status === 'scheduled' || a.status === 'confirmed') && now > new Date(a.scheduledStart).getTime()) {
    return Math.floor((now - new Date(a.scheduledStart).getTime()) / 60_000);
  }
  return null;
}

export function AppointmentsBoard({
  from,
  to,
  doctorId,
  source,
  canWrite,
  canCancel,
  busy,
  onTransition,
  onCancel,
}: {
  from: string;
  to: string;
  doctorId?: string;
  source?: string;
  canWrite: boolean;
  canCancel: boolean;
  busy: boolean;
  onTransition: (id: string, status: AppointmentStatus) => void;
  onCancel: (a: Appointment) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const params = {
    pageSize: 200,
    from,
    to,
    ...(doctorId ? { doctorId } : {}),
    ...(source ? { source } : {}),
  };
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['appointments-board', params],
    queryFn: () => fetchAppointments(params),
    placeholderData: keepPreviousData,
  });

  if (isError) return <Alert>{getErrorMessage(error)}</Alert>;
  if (isPending && !data) return <Skeleton className="h-80 w-full" />;

  const byStatus = (s: AppointmentStatus) => (data?.data ?? []).filter((a) => a.status === s);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {COLUMNS.map((col) => {
        const items = byStatus(col);
        return (
          <div key={col} className="plate flex min-h-[8rem] flex-col">
            <div className="flex items-center justify-between border-b border-rule bg-surface-sunk px-3 py-2">
              <span className="field-label">{APPOINTMENT_STATUS_LABELS[col]}</span>
              <span className="tabular text-xs text-ink-faint">{items.length}</span>
            </div>
            <div className="flex-1 space-y-2 p-2">
              {items.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-faint">—</p>
              ) : (
                items.map((a) => {
                  const wait = waitMinutes(a, now);
                  const warn = wait !== null && wait >= WARN_MIN;
                  const next = NEXT_STATUSES[a.status];
                  return (
                    <div
                      key={a.id}
                      className={cx(
                        'rounded-md border bg-surface p-2.5',
                        warn ? 'border-l-[3px] border-l-danger border-rule' : 'border-rule',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="tabular text-xs font-semibold text-ink">
                          {formatTimeRange(a.scheduledStart, a.scheduledEnd)}
                        </span>
                        {wait !== null && (
                          <Badge tone={warn ? 'danger' : 'neutral'}>chờ {wait}′</Badge>
                        )}
                      </div>
                      <Link
                        to={`/benh-nhan/${a.patientId}`}
                        className="mt-1 block truncate text-sm font-medium text-ink hover:underline"
                      >
                        {a.patientName}
                      </Link>
                      <div className="truncate text-xs text-ink-soft">
                        {a.doctorName}
                        {a.room ? ` · ${a.room}` : ''}
                      </div>
                      {(canWrite || canCancel) && (next.length > 0 || canCancel) && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {canWrite &&
                            next.map((s) => (
                              <Button
                                key={s}
                                variant="ghost"
                                className="h-7 px-2 text-[11px]"
                                disabled={busy}
                                onClick={() => onTransition(a.id, s)}
                              >
                                {APPOINTMENT_STATUS_LABELS[s]}
                              </Button>
                            ))}
                          {canCancel && a.status !== 'completed' && (
                            <Button
                              variant="danger"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => onCancel(a)}
                            >
                              Huỷ
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
