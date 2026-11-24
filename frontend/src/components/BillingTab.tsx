import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchPatientOrders, createOrder, vnd, ORDER_STATUS_VI, ORDER_STATUS_TONE } from '../lib/billing';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Alert, Badge, Skeleton } from './ui';
import { OrderDialog } from './OrderDialog';

export function BillingTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const canManage = useAuthStore((s) => s.can)('billing:manage');
  const orders = useQuery({ queryKey: ['patient-orders', patientId], queryFn: () => fetchPatientOrders(patientId) });
  const [openId, setOpenId] = useState<string | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['patient-orders', patientId] });
    void qc.invalidateQueries({ queryKey: ['billing-receivables'] });
  };

  const create = useMutation({
    mutationFn: () => createOrder(patientId),
    onSuccess: (o) => { setOpenId(o.id); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Button className="h-8 px-3 text-xs" loading={create.isPending} onClick={() => create.mutate()}>+ Tạo đơn mới</Button>
        </div>
      )}
      {orders.isLoading ? (
        <Skeleton className="h-24" />
      ) : orders.isError ? (
        <Alert>{getErrorMessage(orders.error)}</Alert>
      ) : orders.data && orders.data.length > 0 ? (
        <div className="divide-y divide-rule rounded-lg border border-rule">
          {orders.data.map((o) => (
            <button key={o.id} type="button" onClick={() => setOpenId(o.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-sunk">
              <div className="flex items-center gap-2">
                <span className="tabular font-medium text-accent">{o.code}</span>
                <Badge tone={ORDER_STATUS_TONE[o.status] ?? 'neutral'}>{ORDER_STATUS_VI[o.status] ?? o.status}</Badge>
                <span className="text-xs text-ink-faint">{new Date(o.createdAt).toLocaleDateString('vi-VN')}</span>
              </div>
              <div className="text-right">
                <div className="tabular font-medium">{vnd(o.totalVnd)}</div>
                {o.remainingVnd > 0 && <div className="tabular text-xs text-danger">Còn {vnd(o.remainingVnd)}</div>}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-ink-soft">Chưa có đơn nào.</p>
      )}
      {openId && <OrderDialog orderId={openId} onClose={() => setOpenId(null)} onChanged={invalidate} />}
    </div>
  );
}
