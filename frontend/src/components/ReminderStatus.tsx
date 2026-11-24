import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchReminders,
  REMINDER_STATUS_LABELS,
  CHANNEL_LABELS,
  reminderTone,
  formatDateTime,
} from '../lib/clinical';
import { Badge } from './ui';

/**
 * Trạng thái nhắc lịch cho một lịch hẹn — tải LƯỜI khi người dùng bấm mở, để
 * danh sách 20 lịch hẹn không bắn 20 request lúc tải trang.
 */
export function ReminderStatus({ appointmentId }: { appointmentId: string }) {
  const [open, setOpen] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ['reminders', appointmentId],
    queryFn: () => fetchReminders(appointmentId),
    enabled: open,
  });

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-accent hover:underline"
        aria-expanded={open}
      >
        {open ? 'Ẩn nhắc lịch' : 'Nhắc lịch'}
      </button>

      {open && (
        <div className="mt-1.5">
          {isPending ? (
            <span className="text-xs text-ink-faint">Đang tải…</span>
          ) : data && data.length > 0 ? (
            <ul className="space-y-1">
              {data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                  <Badge tone={reminderTone(r.status)}>{REMINDER_STATUS_LABELS[r.status]}</Badge>
                  <span>{CHANNEL_LABELS[r.channel]}</span>
                  <span className="tabular text-ink-faint">
                    {r.sentAt ? `gửi ${formatDateTime(r.sentAt)}` : `hẹn gửi ${formatDateTime(r.scheduledFor)}`}
                  </span>
                  {r.failureReason && r.status !== 'sent' && (
                    <span className="text-ink-faint">· {r.failureReason}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-ink-faint">Không có nhắc lịch nào cho lịch hẹn này.</span>
          )}
        </div>
      )}
    </div>
  );
}
