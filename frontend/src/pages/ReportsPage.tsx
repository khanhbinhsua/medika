import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  fetchOverview,
  fetchAppointmentsByStatus,
  fetchAppointmentsTimeline,
  fetchProviderProductivity,
  exportReportCsv,
  APPOINTMENT_STATUS_VI,
} from '../lib/reports';
import type { StatusCount, TimelinePoint, ProviderProductivity } from '../lib/reports';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Alert, Skeleton, cx } from '../components/ui';
import { PageHeader } from '../components/PageHeader';

const RANGES = [
  { days: 7, label: '±7 ngày' },
  { days: 30, label: '±30 ngày' },
  { days: 90, label: '±90 ngày' },
];

/**
 * Cửa sổ quanh hôm nay: từ (nay − days) đến (nay + days). Bao gồm cả lịch đã
 * qua lẫn lịch sắp tới — phòng khám cần thấy tải công việc hai chiều, không chỉ
 * quá khứ.
 */
function rangeFor(days: number) {
  const now = Date.now();
  return {
    from: new Date(now - days * 86_400_000).toISOString(),
    to: new Date(now + days * 86_400_000).toISOString(),
  };
}

export function ReportsPage() {
  const can = useAuthStore((s) => s.can);
  const [days, setDays] = useState(30);
  const range = rangeFor(days);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Báo cáo & thống kê"
        meta="Số liệu tổng hợp — không chứa thông tin định danh bệnh nhân"
        action={
          can('report:export') ? (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() =>
                  exportReportCsv('appointments-timeline', range.from, range.to).catch((e) => toast.error(getErrorMessage(e)))
                }
              >
                Xuất lịch hẹn (CSV)
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  exportReportCsv('provider-productivity', range.from, range.to).catch((e) => toast.error(getErrorMessage(e)))
                }
              >
                Xuất năng suất (CSV)
              </Button>
            </div>
          ) : undefined
        }
      />

      <OverviewSection />

      <div className="flex flex-wrap items-center gap-2">
        <span className="field-label">Khoảng thời gian</span>
        {RANGES.map((r) => (
          <Button
            key={r.days}
            variant="ghost"
            className={cx('h-8 px-3 text-xs', days === r.days && 'border-accent text-accent')}
            onClick={() => setDays(r.days)}
          >
            {r.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <StatusSection range={range} />
        <TimelineSection range={range} />
      </div>

      <ProviderSection range={range} />
    </div>
  );
}

// ── Tổng quan ─────────────────────────────────────────────────────────

function OverviewSection() {
  const { data, isPending, isError, error } = useQuery({ queryKey: ['report-overview'], queryFn: fetchOverview });

  if (isError) return <Alert>{getErrorMessage(error)}</Alert>;

  const tiles: Array<{ label: string; value: number | undefined; tone?: 'warn' }> = [
    { label: 'Bệnh nhân đang theo dõi', value: data?.activePatients },
    { label: 'Bệnh nhân mới (30 ngày)', value: data?.newPatientsLast30d },
    { label: 'Lịch hẹn sắp tới', value: data?.appointmentsUpcoming },
    { label: 'Hoàn thành (30 ngày)', value: data?.appointmentsCompletedLast30d },
    { label: 'Đơn thuốc đang dùng', value: data?.activePrescriptions },
    { label: 'Tài liệu', value: data?.documentsTotal },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="plate p-4">
          <div className="field-label">{t.label}</div>
          <div
            className={cx(
              'tabular mt-2 text-2xl font-semibold tracking-tight',
              t.tone === 'warn' && (t.value ?? 0) > 0 ? 'text-warn' : 'text-ink',
            )}
          >
            {isPending || t.value === undefined ? <Skeleton className="h-7 w-12" /> : t.value.toLocaleString('vi-VN')}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Phân bố theo trạng thái (thanh ngang CSS) ─────────────────────────

function StatusSection({ range }: { range: { from: string; to: string } }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['report-status', range],
    queryFn: () => fetchAppointmentsByStatus(range.from, range.to),
  });

  return (
    <section className="plate">
      <h2 className="field-label border-b border-rule bg-surface-sunk px-4 py-2">Lịch hẹn theo trạng thái</h2>
      <div className="p-4">
        {isError ? (
          <Alert>{getErrorMessage(error)}</Alert>
        ) : isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : data && data.length > 0 ? (
          <StatusBars data={data} />
        ) : (
          <p className="py-6 text-center text-sm text-ink-soft">Không có lịch hẹn trong khoảng này.</p>
        )}
      </div>
    </section>
  );
}

function StatusBars({ data }: { data: StatusCount[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.status}>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-ink-soft">{APPOINTMENT_STATUS_VI[d.status] ?? d.status}</span>
            <span className="tabular font-medium text-ink">{d.count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-sm bg-surface-sunk">
            <div className="h-full rounded-sm bg-accent" style={{ width: `${(d.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Xu hướng theo ngày (cột dọc CSS) ──────────────────────────────────

function TimelineSection({ range }: { range: { from: string; to: string } }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['report-timeline', range],
    queryFn: () => fetchAppointmentsTimeline(range.from, range.to),
  });

  return (
    <section className="plate">
      <h2 className="field-label border-b border-rule bg-surface-sunk px-4 py-2">Số lịch hẹn theo ngày</h2>
      <div className="p-4">
        {isError ? (
          <Alert>{getErrorMessage(error)}</Alert>
        ) : isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : data && data.length > 0 ? (
          <TimelineBars data={data} />
        ) : (
          <p className="py-6 text-center text-sm text-ink-soft">Không có lịch hẹn trong khoảng này.</p>
        )}
      </div>
    </section>
  );
}

function TimelineBars({ data }: { data: TimelinePoint[] }) {
  // Chỉ hiển thị tối đa 30 cột gần nhất để không quá chật.
  const points = data.slice(-30);
  // Chuẩn hoá theo đúng các cột ĐANG vẽ (không lấy max của cả chuỗi ngoài khung).
  const max = Math.max(...points.map((d) => d.total), 1);
  return (
    <div>
      <div className="flex h-40 items-end gap-0.5">
        {points.map((p) => (
          <div
            key={p.day}
            // h-full: cho thẻ cha có chiều cao xác định (= chiều cao hàng) để
            // height:% của cột resolve được — nếu không, mọi cột sẽ sập về minHeight.
            className="group relative flex h-full flex-1 flex-col items-center justify-end"
            title={`${p.day}: ${p.total} lịch`}
          >
            <div
              className="w-full rounded-t-sm bg-accent transition-opacity hover:opacity-70"
              style={{ height: `${(p.total / max) * 100}%`, minHeight: p.total > 0 ? '3px' : '0' }}
            />
          </div>
        ))}
      </div>
      <div className="tabular mt-2 flex justify-between text-[10px] text-ink-faint">
        <span>{points[0]?.day}</span>
        <span>{points[points.length - 1]?.day}</span>
      </div>
    </div>
  );
}

// ── Năng suất bác sĩ ──────────────────────────────────────────────────

function ProviderSection({ range }: { range: { from: string; to: string } }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['report-provider', range],
    queryFn: () => fetchProviderProductivity(range.from, range.to),
  });

  return (
    <section className="plate overflow-hidden">
      <h2 className="field-label border-b border-rule bg-surface-sunk px-4 py-2">Năng suất theo bác sĩ</h2>
      {isError ? (
        <div className="p-4">
          <Alert>{getErrorMessage(error)}</Alert>
        </div>
      ) : isPending ? (
        <div className="p-4">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="field-label px-4 py-2.5">Bác sĩ</th>
                <th className="field-label px-4 py-2.5 text-right">Lịch hẹn</th>
                <th className="field-label px-4 py-2.5 text-right">Hoàn thành</th>
                <th className="field-label px-4 py-2.5 text-right">Đơn thuốc</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((d: ProviderProductivity) => (
                <tr key={d.doctorId} className="border-b border-rule last:border-0">
                  <td className="px-4 py-2.5 text-ink">{d.doctorName}</td>
                  <td className="tabular px-4 py-2.5 text-right text-ink-soft">{d.appointments}</td>
                  <td className="tabular px-4 py-2.5 text-right text-ink-soft">{d.completed}</td>
                  <td className="tabular px-4 py-2.5 text-right text-ink-soft">{d.prescriptions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
