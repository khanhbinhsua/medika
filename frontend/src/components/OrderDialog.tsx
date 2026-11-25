import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  getOrder, fetchCatalog, addLine, removeLine, takePayment, cancelOrder,
  vnd, ORDER_STATUS_VI, ORDER_STATUS_TONE, METHOD_VI, METHODS,
} from '../lib/billing';
import { fetchPatient, fullName } from '../lib/patients';
import { printReceipt } from '../lib/print';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Field, Input, Alert, Badge, Skeleton } from './ui';
import { DialogShell } from './DialogShell';

const sel = 'h-9 w-full rounded-md border border-rule-strong bg-surface px-2 text-sm text-ink';

export function OrderDialog({ orderId, onClose, onChanged }: { orderId: string; onClose: () => void; onChanged?: () => void }) {
  const qc = useQueryClient();
  const canManage = useAuthStore((s) => s.can)('billing:manage');
  const order = useQuery({ queryKey: ['order', orderId], queryFn: () => getOrder(orderId) });
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog, enabled: canManage });
  const patient = useQuery({
    queryKey: ['patient', order.data?.patientId],
    queryFn: () => fetchPatient(order.data!.patientId),
    enabled: !!order.data?.patientId,
  });

  const [svc, setSvc] = useState('');
  const [pkg, setPkg] = useState('');
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState('');

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['order', orderId] }); onChanged?.(); };
  const wrap = (p: Promise<unknown>) => p.then(refresh).catch((e) => toast.error(getErrorMessage(e)));

  const addSvc = useMutation({ mutationFn: () => addLine(orderId, { serviceId: svc }), onSuccess: () => { setSvc(''); refresh(); }, onError: (e) => toast.error(getErrorMessage(e)) });
  const addPkg = useMutation({ mutationFn: () => addLine(orderId, { packageId: pkg }), onSuccess: () => { setPkg(''); refresh(); }, onError: (e) => toast.error(getErrorMessage(e)) });
  const pay = useMutation({
    mutationFn: () => takePayment(orderId, method, Number(amount)),
    onSuccess: (o) => { setAmount(''); refresh(); if (o.status === 'paid') toast.success('Đã thanh toán đủ'); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const o = order.data;
  const locked = !o || o.status === 'paid' || o.status === 'cancelled';

  return (
    <DialogShell eyebrow={o ? `Đơn ${o.code}` : 'Đơn hàng'} title={o ? `${ORDER_STATUS_VI[o.status] ?? o.status}` : 'Đang tải…'} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4 p-5">
        {order.isLoading ? (
          <Skeleton className="h-48" />
        ) : order.isError ? (
          <Alert>{getErrorMessage(order.error)}</Alert>
        ) : o ? (
          <>
            {/* Dòng đơn */}
            <div className="divide-y divide-rule rounded-lg border border-rule">
              {o.lines.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-ink-soft">Chưa có dòng nào.</p>
              ) : (
                o.lines.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{l.name}</span>
                      {l.kind === 'package' && <Badge tone="accent">Gói</Badge>}
                      <span className="tabular ml-2 text-xs text-ink-soft">{l.qty} × {vnd(l.unitPriceVnd)}{l.discountVnd ? ` − ${vnd(l.discountVnd)}` : ''}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular font-medium">{vnd(l.amountVnd)}</span>
                      {canManage && !locked && (
                        <button type="button" onClick={() => wrap(removeLine(orderId, l.id))} className="text-xs text-danger hover:underline">Xoá</button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Thêm dịch vụ / gói */}
            {canManage && !locked && catalog.data && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex gap-2">
                  <select value={svc} onChange={(e) => setSvc(e.target.value)} className={sel}>
                    <option value="">+ Dịch vụ…</option>
                    {catalog.data.services.map((s) => <option key={s.id} value={s.id}>{s.name} · {vnd(s.priceVnd)}</option>)}
                  </select>
                  <Button className="h-9 px-3 text-xs" disabled={!svc} loading={addSvc.isPending} onClick={() => addSvc.mutate()}>Thêm</Button>
                </div>
                <div className="flex gap-2">
                  <select value={pkg} onChange={(e) => setPkg(e.target.value)} className={sel}>
                    <option value="">+ Gói liệu trình…</option>
                    {catalog.data.packages.map((p) => <option key={p.id} value={p.id}>{p.name} · {vnd(p.priceVnd)}</option>)}
                  </select>
                  <Button className="h-9 px-3 text-xs" disabled={!pkg} loading={addPkg.isPending} onClick={() => addPkg.mutate()}>Thêm</Button>
                </div>
              </div>
            )}

            {/* Tổng kết tiền */}
            <div className="rounded-lg border border-rule bg-surface-sunk p-3">
              <div className="flex justify-between text-sm"><span className="text-ink-soft">Tổng</span><span className="tabular font-medium">{vnd(o.totalVnd)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-ink-soft">Đã thu</span><span className="tabular text-ok">{vnd(o.paidVnd)}</span></div>
              <div className="mt-1 flex justify-between border-t border-rule pt-1 text-sm"><span className="font-medium">Còn lại</span><span className="tabular text-lg font-semibold text-danger">{vnd(o.remainingVnd)}</span></div>
              <div className="mt-2 flex items-center justify-between">
                <Badge tone={ORDER_STATUS_TONE[o.status] ?? 'neutral'}>{ORDER_STATUS_VI[o.status] ?? o.status}</Badge>
                <Button
                  variant="ghost"
                  className="h-8 px-3 text-xs"
                  disabled={!patient.data || o.lines.length === 0}
                  onClick={() => patient.data && printReceipt({ order: o, patientName: fullName(patient.data), mrn: patient.data.mrn })}
                >
                  In biên nhận
                </Button>
              </div>
            </div>

            {/* Thu tiền */}
            {canManage && o.status !== 'cancelled' && o.remainingVnd > 0 && (
              <form onSubmit={(e) => { e.preventDefault(); if (Number(amount) > 0) pay.mutate(); }} className="grid grid-cols-2 gap-2 rounded-lg border border-rule p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field label="Phương thức">
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className={sel}>
                    {METHODS.map((m) => <option key={m} value={m}>{METHOD_VI[m]}</option>)}
                  </select>
                </Field>
                <Field label="Số tiền (₫)">
                  <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} placeholder={String(o.remainingVnd)} />
                </Field>
                <Button type="submit" loading={pay.isPending} disabled={!amount || Number(amount) <= 0}>Thu tiền</Button>
                <button type="button" onClick={() => setAmount(String(o.remainingVnd))} className="col-span-2 text-left text-xs text-accent hover:underline sm:col-span-3">Thu đủ phần còn lại ({vnd(o.remainingVnd)})</button>
              </form>
            )}

            {/* Lịch sử thu + huỷ */}
            {o.payments.length > 0 && (
              <div className="text-xs text-ink-soft">
                {o.payments.map((p) => <div key={p.id} className="flex justify-between"><span>{METHOD_VI[p.method] ?? p.method} · {new Date(p.paidAt).toLocaleString('vi-VN')}</span><span className="tabular">{vnd(p.amountVnd)}</span></div>)}
              </div>
            )}
            {canManage && o.payments.length === 0 && o.status !== 'cancelled' && (
              <button type="button" onClick={() => window.confirm('Huỷ đơn này?') && wrap(cancelOrder(orderId).then(() => onClose()))} className="text-xs text-danger hover:underline">Huỷ đơn</button>
            )}
          </>
        ) : null}
      </div>
    </DialogShell>
  );
}
