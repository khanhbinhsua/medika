import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  fetchAuditLogs,
  fetchPhiAccess,
  fetchIntegrity,
  fetchAnomalies,
  fetchComplianceSummary,
  ACTION_LABELS,
  ACCESS_TYPE_LABELS,
  OUTCOME_LABELS,
  SEVERITY_LABELS,
} from '../lib/compliance';
import type { Anomaly, IntegrityResult } from '../lib/compliance';
import { formatDateTime } from '../lib/clinical';
import { getErrorMessage } from '../lib/api-client';
import { Button, Alert, Badge, Skeleton, cx } from '../components/ui';
import { PageHeader } from '../components/PageHeader';

type Tab = 'overview' | 'anomalies' | 'activity' | 'phi';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'anomalies', label: 'Cảnh báo' },
  { id: 'activity', label: 'Hoạt động hệ thống' },
  { id: 'phi', label: 'Truy cập hồ sơ' },
];

export function AuditPage() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="Nhật ký kiểm toán" meta="HIPAA §164.308(a)(1)(ii)(D) · §164.312(b) · §164.528" />

      <div className="flex overflow-x-auto border-b border-rule" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              'relative whitespace-nowrap px-4 py-2.5 text-sm transition-colors duration-150',
              tab === t.id ? 'font-medium text-ink' : 'text-ink-soft hover:text-ink',
            )}
          >
            {t.label}
            <span
              className={cx(
                'absolute inset-x-2 -bottom-px h-0.5 transition-opacity duration-150',
                tab === t.id ? 'bg-accent opacity-100' : 'opacity-0',
              )}
            />
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'anomalies' && <AnomaliesTab />}
      {tab === 'activity' && <ActivityTab />}
      {tab === 'phi' && <PhiTab />}
    </div>
  );
}

// ── Tổng quan ─────────────────────────────────────────────────────────

function OverviewTab() {
  const summary = useQuery({ queryKey: ['compliance-summary'], queryFn: fetchComplianceSummary });
  const integrity = useQuery({ queryKey: ['integrity'], queryFn: fetchIntegrity });

  return (
    <div className="space-y-5">
      <IntegrityCard result={integrity.data} loading={integrity.isPending} error={integrity.error} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Tài khoản đang hoạt động" value={summary.data?.activeUsers} />
        <Stat
          label="Tỉ lệ bật xác thực hai bước"
          value={summary.data === undefined ? undefined : `${summary.data.mfaCoveragePercent}%`}
          note={summary.data ? `${summary.data.mfaEnabled}/${summary.data.activeUsers} tài khoản` : undefined}
          tone={summary.data && summary.data.mfaCoveragePercent < 100 ? 'warn' : 'ok'}
        />
        <Stat label="Hồ sơ bệnh nhân" value={summary.data?.activePatients} />
        <Stat label="Lượt truy cập hồ sơ (24h)" value={summary.data?.phiAccessLast24h} />
        <Stat
          label="Lượt bị từ chối quyền (24h)"
          value={summary.data?.deniedLast24h}
          tone={summary.data && summary.data.deniedLast24h > 0 ? 'warn' : 'ok'}
        />
      </div>
    </div>
  );
}

function IntegrityCard({
  result,
  loading,
  error,
}: {
  result: IntegrityResult | undefined;
  loading: boolean;
  error: unknown;
}) {
  if (loading) return <Skeleton className="h-28 w-full" />;
  if (error) return <Alert>{getErrorMessage(error)}</Alert>;
  if (!result) return null;

  const skipped = result.entriesBeforeBaseline ?? 0;

  return (
    <section
      className={cx(
        'plate p-4',
        result.valid ? 'border-l-[3px] border-l-ok' : 'border-l-[3px] border-l-danger',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="field-label">Toàn vẹn nhật ký</div>
          <h2 className="mt-1 text-base font-semibold tracking-tight">
            {result.valid ? 'Chuỗi hash nguyên vẹn' : 'Phát hiện dấu hiệu giả mạo'}
          </h2>
          <p className="tabular mt-1 text-xs text-ink-soft">
            Đã kiểm tra {result.entriesChecked.toLocaleString('vi-VN')} dòng
          </p>
        </div>
        <Badge tone={result.valid ? 'ok' : 'danger'}>{result.valid ? 'Đạt' : 'Không đạt'}</Badge>
      </div>

      {!result.valid && (
        <div className="mt-3">
          <Alert>
            {result.detail}
            {result.brokenAtId && <span className="tabular"> (dòng #{result.brokenAtId})</span>}
          </Alert>
        </div>
      )}

      {/* Số dòng nằm ngoài phạm vi kiểm tra phải luôn hiển thị — nếu giấu đi thì
          một mốc chuẩn bị đẩy lên có thể che lấp giả mạo mà không ai biết. */}
      {skipped > 0 && (
        <p className="rule-t mt-3 pt-3 text-xs text-warn">
          {skipped.toLocaleString('vi-VN')} dòng trước mốc chuẩn #{result.baselineId} không nằm trong phạm vi
          kiểm tra.
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: number | string | undefined;
  note?: string | undefined;
  tone?: 'neutral' | 'ok' | 'warn';
}) {
  return (
    <div className="plate p-4">
      <div className="field-label">{label}</div>
      <div
        className={cx(
          'tabular mt-2 text-2xl font-semibold tracking-tight',
          tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-ink',
        )}
      >
        {value === undefined ? <Skeleton className="h-7 w-16" /> : value.toLocaleString('vi-VN')}
      </div>
      {note && <div className="mt-1 text-xs text-ink-faint">{note}</div>}
    </div>
  );
}

// ── Cảnh báo ──────────────────────────────────────────────────────────

const WINDOWS = [
  { hours: 24, label: '24 giờ' },
  { hours: 24 * 7, label: '7 ngày' },
  { hours: 24 * 30, label: '30 ngày' },
];

function AnomaliesTab() {
  const [windowHours, setWindowHours] = useState(24);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['anomalies', windowHours],
    queryFn: () => fetchAnomalies(windowHours),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="field-label">Khoảng thời gian</span>
        {WINDOWS.map((w) => (
          <Button
            key={w.hours}
            variant="ghost"
            className={cx('h-8 px-3 text-xs', windowHours === w.hours && 'border-accent text-accent')}
            onClick={() => setWindowHours(w.hours)}
          >
            {w.label}
          </Button>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-ink-faint">
        Đây là <span className="text-ink-soft">dấu hiệu cần xem xét</span>, không phải kết luận vi phạm. Mỗi mục
        cần đối chiếu với hoàn cảnh thực tế — ví dụ trực cấp cứu ban đêm là truy cập ngoài giờ hợp lệ.
      </p>

      {isError && <Alert>{getErrorMessage(error)}</Alert>}

      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : data && data.anomalies.length > 0 ? (
        <ul className="space-y-2">
          {data.anomalies.map((a, i) => (
            <AnomalyCard key={`${a.kind}-${a.actorEmail}-${i}`} anomaly={a} />
          ))}
        </ul>
      ) : (
        <div className="plate border-dashed p-12 text-center">
          <p className="text-sm text-ink-soft">Không phát hiện dấu hiệu bất thường nào.</p>
        </div>
      )}
    </div>
  );
}

function AnomalyCard({ anomaly: a }: { anomaly: Anomaly }) {
  const tone = a.severity === 'high' ? 'danger' : a.severity === 'medium' ? 'warn' : 'neutral';
  const border =
    a.severity === 'high' ? 'border-l-danger' : a.severity === 'medium' ? 'border-l-warn' : 'border-l-rule-strong';

  return (
    <li className={cx('plate border-l-[3px] p-4', border)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">{a.title}</span>
            <Badge tone={tone}>{SEVERITY_LABELS[a.severity]}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-soft">{a.detail}</p>
          <div className="mt-1.5 text-xs text-ink-faint">
            {a.actorEmail ?? 'không rõ tài khoản'} · <span className="tabular">{formatDateTime(a.occurredAt)}</span>
          </div>
        </div>
      </div>
    </li>
  );
}

// ── Hoạt động hệ thống ────────────────────────────────────────────────

function ActivityTab() {
  const [page, setPage] = useState(1);
  const [outcome, setOutcome] = useState<string>('');

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['audit-logs', page, outcome],
    queryFn: () => fetchAuditLogs({ page, pageSize: 50, ...(outcome ? { outcome } : {}) }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="field-label">Kết quả</span>
        {[
          { v: '', label: 'Tất cả' },
          { v: 'success', label: 'Thành công' },
          { v: 'denied', label: 'Bị từ chối' },
          { v: 'failure', label: 'Thất bại' },
        ].map((o) => (
          <Button
            key={o.v}
            variant="ghost"
            className={cx('h-8 px-3 text-xs', outcome === o.v && 'border-accent text-accent')}
            onClick={() => {
              setOutcome(o.v);
              setPage(1);
            }}
          >
            {o.label}
          </Button>
        ))}
      </div>

      {isError && <Alert>{getErrorMessage(error)}</Alert>}

      <div className="plate overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule bg-surface-sunk text-left">
                <th className="field-label px-3 py-2.5 w-40">Thời điểm</th>
                <th className="field-label px-3 py-2.5">Hành động</th>
                <th className="field-label px-3 py-2.5 w-52">Tài khoản</th>
                <th className="field-label px-3 py-2.5 w-28">Kết quả</th>
                <th className="field-label px-3 py-2.5 w-36">Địa chỉ IP</th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-rule last:border-0">
                    <td colSpan={5} className="px-3 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))
              ) : data && data.data.length > 0 ? (
                data.data.map((log) => (
                  <tr key={log.id} className="border-b border-rule last:border-0 hover:bg-surface-sunk">
                    <td className="tabular px-3 py-2.5 text-xs text-ink-soft">{formatDateTime(log.createdAt)}</td>
                    <td className="px-3 py-2.5">
                      <div className="text-ink">{ACTION_LABELS[log.action] ?? log.action}</div>
                      {log.reason && <div className="mt-0.5 text-xs text-ink-faint">{log.reason}</div>}
                    </td>
                    <td className="truncate px-3 py-2.5 text-xs text-ink-soft">{log.actorEmail ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <Badge
                        tone={log.outcome === 'success' ? 'ok' : log.outcome === 'denied' ? 'warn' : 'danger'}
                      >
                        {OUTCOME_LABELS[log.outcome]}
                      </Badge>
                    </td>
                    <td className="tabular px-3 py-2.5 text-xs text-ink-faint">{log.ipAddress ?? '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-3 py-16 text-center text-sm text-ink-soft">
                    Không có bản ghi nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pager data={data} page={page} onPage={setPage} />
      </div>
    </div>
  );
}

// ── Truy cập hồ sơ ────────────────────────────────────────────────────

function PhiTab() {
  const [page, setPage] = useState(1);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['phi-access', page],
    queryFn: () => fetchPhiAccess({ page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-ink-faint">
        Ghi nhận từng lượt giải mã dữ liệu bệnh nhân, phục vụ quyền được biết ai đã xem hồ sơ của mình
        (HIPAA §164.528).
      </p>

      {isError && <Alert>{getErrorMessage(error)}</Alert>}

      <div className="plate overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule bg-surface-sunk text-left">
                <th className="field-label px-3 py-2.5 w-40">Thời điểm</th>
                <th className="field-label px-3 py-2.5">Bệnh nhân</th>
                <th className="field-label px-3 py-2.5 w-48">Người truy cập</th>
                <th className="field-label px-3 py-2.5 w-24">Thao tác</th>
                <th className="field-label px-3 py-2.5">Trường đã xem</th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-rule last:border-0">
                    <td colSpan={5} className="px-3 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))
              ) : data && data.data.length > 0 ? (
                data.data.map((log) => (
                  <tr key={log.id} className="border-b border-rule last:border-0 hover:bg-surface-sunk">
                    <td className="tabular px-3 py-2.5 text-xs text-ink-soft">{formatDateTime(log.accessedAt)}</td>
                    <td className="px-3 py-2.5">
                      <Link to={`/benh-nhan/${log.patientId}`} className="text-ink hover:underline">
                        {log.patientName}
                      </Link>
                      <div className="tabular mt-0.5 text-xs text-ink-faint">{log.patientMrn}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <div className="text-ink">{log.actorName}</div>
                      <div className="truncate text-ink-faint">{log.actorEmail}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge>{ACCESS_TYPE_LABELS[log.accessType] ?? log.accessType}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink-soft">{log.fieldsAccessed.join(', ')}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-3 py-16 text-center text-sm text-ink-soft">
                    Chưa có lượt truy cập nào được ghi nhận.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pager data={data} page={page} onPage={setPage} />
      </div>
    </div>
  );
}

function Pager({
  data,
  page,
  onPage,
}: {
  data: { pagination: { page: number; totalPages: number; total: number } } | undefined;
  page: number;
  onPage: (p: number) => void;
}) {
  if (!data || data.pagination.totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-rule px-3 py-2.5">
      <span className="tabular text-xs text-ink-faint">
        Trang {data.pagination.page} / {data.pagination.totalPages} · {data.pagination.total.toLocaleString('vi-VN')}{' '}
        bản ghi
      </span>
      <div className="flex gap-2">
        <Button variant="ghost" className="h-8 px-3 text-xs" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Trước
        </Button>
        <Button
          variant="ghost"
          className="h-8 px-3 text-xs"
          disabled={page >= data.pagination.totalPages}
          onClick={() => onPage(page + 1)}
        >
          Sau
        </Button>
      </div>
    </div>
  );
}
