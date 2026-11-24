import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  fetchTopSpenders,
  fetchTiers,
  importTransactions,
  parseCsv,
  TIER_TONE,
  vnd,
} from '../lib/spending';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Alert, Badge, Skeleton, cx } from '../components/ui';
import { PageHeader } from '../components/PageHeader';

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('vi-VN') : '—');

export function SpendingPage() {
  const can = useAuthStore((s) => s.can);
  const [tier, setTier] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const tiers = useQuery({ queryKey: ['spending-tiers'], queryFn: fetchTiers });
  const top = useQuery({ queryKey: ['spending-top', tier], queryFn: () => fetchTopSpenders(tier ? { tier } : {}) });

  async function onFile(file: File) {
    setImporting(true);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length === 0) {
        toast.error('Không đọc được dòng nào. Cần cột: mrn, ngày, số tiền, loại, ghi chú');
        return;
      }
      const res = await importTransactions(rows);
      toast.success(`Đã nhập ${res.imported} khoản chi${res.skipped.length ? `, bỏ qua ${res.skipped.length}` : ''}`);
      void top.refetch();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Chăm sóc theo chi tiêu"
        meta="Xếp hạng khách theo tổng chi tiêu để chăm sóc & giữ chân khách VIP"
        action={
          can('spending:write') ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
              <Button variant="ghost" loading={importing} onClick={() => fileRef.current?.click()}>
                Nhập CSV
              </Button>
            </>
          ) : undefined
        }
      />

      {/* Bộ lọc hạng */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="field-label">Hạng khách</span>
        <button
          type="button"
          onClick={() => setTier('')}
          className={cx('rounded border px-2.5 py-1 text-xs', tier === '' ? 'border-accent text-accent' : 'border-rule-strong text-ink-soft hover:bg-surface')}
        >
          Tất cả
        </button>
        {tiers.data?.map((t) => (
          <button
            key={t.code}
            type="button"
            onClick={() => setTier(t.code)}
            className={cx('rounded border px-2.5 py-1 text-xs', tier === t.code ? 'border-accent text-accent' : 'border-rule-strong text-ink-soft hover:bg-surface')}
          >
            {t.name} <span className="text-ink-faint">≥{(t.minTotal / 1_000_000).toFixed(0)}tr</span>
          </button>
        ))}
      </div>

      {/* Gợi ý nhóm marketing VIP */}
      {can('marketing:read') && (
        <div className="rounded-lg border border-rule bg-surface-sunk px-4 py-2.5 text-sm text-ink-soft">
          Muốn gửi ưu đãi cho nhóm khách chi nhiều? Sang{' '}
          <Link to="/marketing" className="text-accent hover:underline">Marketing</Link>{' '}
          tạo nhóm với tiêu chí <span className="tabular text-ink">tổng chi tiêu ≥ ngưỡng</span> rồi chạy chiến dịch.
        </div>
      )}

      {/* Bảng top khách */}
      <section className="plate overflow-hidden">
        <h2 className="field-label border-b border-rule bg-surface-sunk px-4 py-2">Khách chi nhiều nhất</h2>
        {top.isLoading ? (
          <div className="p-4"><Skeleton className="h-40 w-full" /></div>
        ) : top.isError ? (
          <div className="p-4"><Alert>{getErrorMessage(top.error)}</Alert></div>
        ) : top.data && top.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-rule text-left">
                  <th className="field-label px-4 py-2.5 w-8">#</th>
                  <th className="field-label px-4 py-2.5">Khách hàng</th>
                  <th className="field-label px-4 py-2.5">Hạng</th>
                  <th className="field-label px-4 py-2.5 text-right">Tổng chi tiêu</th>
                  <th className="field-label px-4 py-2.5 text-right">Số lần</th>
                  <th className="field-label px-4 py-2.5 text-right">Gần nhất</th>
                </tr>
              </thead>
              <tbody>
                {top.data.map((r, i) => (
                  <tr key={r.patientId} className="border-b border-rule last:border-0 hover:bg-surface-sunk">
                    <td className="tabular px-4 py-2.5 text-ink-faint">{i + 1}</td>
                    <td className="px-4 py-2.5">
                      <Link to={`/benh-nhan/${r.patientId}`} className="text-accent hover:underline">
                        {r.name}
                      </Link>
                      <span className="tabular ml-2 text-xs text-ink-soft">{r.mrn}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={TIER_TONE[r.tier.code] ?? 'neutral'}>{r.tier.name}</Badge>
                    </td>
                    <td className="tabular px-4 py-2.5 text-right font-medium">{vnd(r.total)}</td>
                    <td className="tabular px-4 py-2.5 text-right text-ink-soft">{r.count}</td>
                    <td className="tabular px-4 py-2.5 text-right text-ink-soft">{fmtDate(r.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-ink-soft">Chưa có dữ liệu chi tiêu.</p>
        )}
      </section>
    </div>
  );
}
