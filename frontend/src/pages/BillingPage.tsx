import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchOrders, fetchReceivables, exportOrdersCsv, vnd, ORDER_STATUS_VI, ORDER_STATUS_TONE } from '../lib/billing';
import { getErrorMessage } from '../lib/api-client';
import { Alert, Badge, Button, Skeleton, Input, cx } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { OrderDialog } from '../components/OrderDialog';

const STATUSES = ['', 'unpaid', 'partial', 'paid', 'cancelled'] as const;

export function BillingPage() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);

  const receivables = useQuery({ queryKey: ['billing-receivables'], queryFn: fetchReceivables });
  const orders = useQuery({
    queryKey: ['billing-orders', status, q],
    queryFn: () => fetchOrders({ status: status || undefined, q: q.trim() || undefined }),
  });

  async function onExport() {
    setExporting(true);
    try {
      await exportOrdersCsv({ status: status || undefined, q: q.trim() || undefined });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Thu ngân" meta="Sổ thanh toán và công nợ — đơn, thu tiền, số còn lại" />

      {/* Công nợ */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="plate p-4">
          <div className="field-label">Tổng công nợ</div>
          <div className="tabular mt-1 text-2xl font-semibold text-danger">
            {receivables.isLoading ? '…' : vnd(receivables.data?.total ?? 0)}
          </div>
        </div>
        <div className="plate p-4">
          <div className="field-label">Số đơn còn nợ</div>
          <div className="tabular mt-1 text-2xl font-semibold">{receivables.isLoading ? '…' : receivables.data?.count ?? 0}</div>
        </div>
      </div>

      {/* Bộ lọc */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatus(s)}
            className={cx('rounded-md border px-2.5 py-1 text-xs', status === s ? 'border-accent text-accent' : 'border-rule-strong text-ink-soft hover:bg-surface-sunk')}
          >
            {s === '' ? 'Tất cả' : ORDER_STATUS_VI[s]}
          </button>
        ))}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã đơn / mã bệnh nhân" className="ml-auto h-8 max-w-[14rem] text-xs" />
        <Button variant="ghost" className="h-8 px-3 text-xs" loading={exporting} onClick={onExport}>
          Xuất Excel
        </Button>
      </div>

      {/* Sổ thanh toán */}
      <section className="plate overflow-hidden">
        <h2 className="field-label border-b border-rule bg-surface-sunk px-4 py-2">Sổ thanh toán</h2>
        {orders.isLoading ? (
          <div className="p-4"><Skeleton className="h-40" /></div>
        ) : orders.isError ? (
          <div className="p-4"><Alert>{getErrorMessage(orders.error)}</Alert></div>
        ) : orders.data && orders.data.length > 0 ? (
          <div className="divide-y divide-rule">
            {orders.data.map((o) => (
              <button key={o.id} type="button" onClick={() => setOpenId(o.id)} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-surface-sunk">
                <div className="flex items-center gap-2">
                  <span className="tabular font-medium text-accent">{o.code}</span>
                  <span className="tabular text-xs text-ink-soft">{o.patientMrn}</span>
                  <Badge tone={ORDER_STATUS_TONE[o.status] ?? 'neutral'}>{ORDER_STATUS_VI[o.status] ?? o.status}</Badge>
                </div>
                <div className="text-right">
                  <span className="tabular font-medium">{vnd(o.totalVnd)}</span>
                  {o.remainingVnd > 0 && <span className="tabular ml-2 text-xs text-danger">Còn {vnd(o.remainingVnd)}</span>}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-ink-soft">Không có đơn phù hợp.</p>
        )}
      </section>

      {openId && <OrderDialog orderId={openId} onClose={() => setOpenId(null)} onChanged={() => { void orders.refetch(); void receivables.refetch(); }} />}
    </div>
  );
}
