import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Calendar,
  dateFnsLocalizer,
  Views,
  type View,
  type Event as RbcEvent,
} from 'react-big-calendar';
import {
  format, parse, getDay,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, endOfDay,
} from 'date-fns';
import { vi } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { fetchAppointments, APPOINTMENT_STATUS_LABELS } from '../lib/clinical';
import type { Appointment } from '../lib/clinical';
import { Alert, Skeleton } from './ui';
import { getErrorMessage } from '../lib/api-client';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales: { vi },
});

const messages = {
  date: 'Ngày', time: 'Giờ', event: 'Lịch hẹn', allDay: 'Cả ngày',
  week: 'Tuần', work_week: 'Tuần làm việc', day: 'Ngày', month: 'Tháng',
  previous: '‹', next: '›', yesterday: 'Hôm qua', tomorrow: 'Ngày mai',
  today: 'Hôm nay', agenda: 'Lịch trình',
  noEventsInRange: 'Không có lịch hẹn trong khoảng này.',
  showMore: (n: number) => `+${n} nữa`,
};

type ApptEvent = RbcEvent & { resource: Appointment };

function rangeFor(date: Date, view: View): { from: string; to: string } {
  if (view === Views.DAY) return { from: startOfDay(date).toISOString(), to: endOfDay(date).toISOString() };
  if (view === Views.WEEK) {
    return {
      from: startOfWeek(date, { weekStartsOn: 1 }).toISOString(),
      to: endOfWeek(date, { weekStartsOn: 1 }).toISOString(),
    };
  }
  // Tháng: lấy rộng ra 7 ngày mỗi phía để phủ các ô tràn tuần đầu/cuối.
  return {
    from: new Date(startOfMonth(date).getTime() - 7 * 86_400_000).toISOString(),
    to: new Date(endOfMonth(date).getTime() + 7 * 86_400_000).toISOString(),
  };
}

export function AppointmentsCalendar({ doctorId, source }: { doctorId?: string; source?: string }) {
  const navigate = useNavigate();
  const [date, setDate] = useState(new Date());
  const [view, setView] = useState<View>(Views.WEEK);

  const range = rangeFor(date, view);
  const params = {
    pageSize: 200,
    from: range.from,
    to: range.to,
    ...(doctorId ? { doctorId } : {}),
    ...(source ? { source } : {}),
  };

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['appointments-cal', params],
    queryFn: () => fetchAppointments(params),
    placeholderData: keepPreviousData,
  });

  const events: ApptEvent[] = useMemo(
    () =>
      (data?.data ?? []).map((a) => ({
        title: `${a.patientName} · ${APPOINTMENT_STATUS_LABELS[a.status]}${a.room ? ` · ${a.room}` : ''}`,
        start: new Date(a.scheduledStart),
        end: new Date(a.scheduledEnd),
        resource: a,
      })),
    [data],
  );

  if (isError) return <Alert>{getErrorMessage(error)}</Alert>;

  return (
    <div className="plate p-3">
      <style>{CALENDAR_CSS}</style>
      {isPending && !data ? (
        <Skeleton className="h-[600px] w-full" />
      ) : (
        <div style={{ height: 640 }}>
          <Calendar
            localizer={localizer}
            culture="vi"
            messages={messages}
            events={events}
            date={date}
            view={view}
            onNavigate={setDate}
            onView={setView}
            views={[Views.MONTH, Views.WEEK, Views.DAY]}
            popup
            onSelectEvent={(e) => navigate(`/benh-nhan/${(e as ApptEvent).resource.patientId}`)}
            eventPropGetter={(e) => {
              const st = (e as ApptEvent).resource.status;
              const bg = st === 'cancelled' || st === 'no_show'
                ? 'rgb(var(--danger))'
                : st === 'completed'
                ? 'rgb(var(--ok))'
                : 'rgb(var(--accent))';
              return { style: { backgroundColor: bg, border: 'none', fontSize: 12 } };
            }}
            style={{ height: '100%' }}
          />
        </div>
      )}
    </div>
  );
}

/* Hoà sắc với theme sáng/tối qua biến CSS của app. */
const CALENDAR_CSS = `
.rbc-calendar { color: rgb(var(--ink)); }
.rbc-toolbar button { color: rgb(var(--ink)); border-color: rgb(var(--rule-strong)); }
.rbc-toolbar button:hover, .rbc-toolbar button:focus { background: rgb(var(--surface-sunk)); }
.rbc-toolbar button.rbc-active { background: rgb(var(--accent)); color: #fff; border-color: rgb(var(--accent)); }
.rbc-month-view, .rbc-time-view, .rbc-time-header, .rbc-header, .rbc-day-bg,
.rbc-month-row, .rbc-time-content, .rbc-timeslot-group, .rbc-day-slot,
.rbc-time-header-content, .rbc-time-gutter, .rbc-header + .rbc-header { border-color: rgb(var(--rule)); }
.rbc-off-range-bg { background: rgb(var(--surface-sunk)); }
.rbc-today { background: rgb(var(--accent-wash)); }
.rbc-event { color: #fff; }
.rbc-show-more { color: rgb(var(--accent)); }
.rbc-current-time-indicator { background: rgb(var(--danger)); }
`;
