import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchPatients, fullName } from '../lib/patients';
import { fetchOrders, ORDER_STATUS_VI, vnd } from '../lib/billing';
import { useAuthStore } from '../stores/auth.store';
import { Badge } from './ui';

/**
 * Tìm toàn cục trên topbar (#3). Tên/email/SĐT khớp CHÍNH XÁC toàn chuỗi (cột mã hoá,
 * không tìm một phần được); mã khách (MRN) và mã đơn khớp một phần.
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const can = useAuthStore((s) => s.can);
  const canPatient = can('patient:read');
  const canBilling = can('billing:read');

  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounce 300ms để không gọi API mỗi phím.
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const enabled = dq.length >= 2 && open;
  const patients = useQuery({
    queryKey: ['search-patients', dq],
    queryFn: () => fetchPatients({ page: 1, pageSize: 6, q: dq }),
    enabled: enabled && canPatient,
  });
  const orders = useQuery({
    queryKey: ['search-orders', dq],
    queryFn: () => fetchOrders({ q: dq }),
    enabled: enabled && canBilling,
  });

  const patientHits = patients.data?.data ?? [];
  const orderHits = (orders.data ?? []).slice(0, 6);
  const loading = patients.isFetching || orders.isFetching;
  const go = (path: string) => {
    setOpen(false);
    setQ('');
    navigate(path);
  };

  if (!canPatient && !canBilling) return <div className="flex-1" />;

  return (
    <div ref={boxRef} className="relative flex-1 max-w-md">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Tìm tên · SĐT · mã khách · mã đơn…"
        className="input-focus h-9 w-full rounded-md border border-rule-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint"
        aria-label="Tìm toàn cục"
      />

      {open && dq.length >= 2 && (
        <div className="float-3 absolute left-0 right-0 top-11 z-30 max-h-[70vh] overflow-auto rounded-md border border-rule bg-surface p-1 text-sm">
          {loading && <div className="px-3 py-2 text-xs text-ink-faint">Đang tìm…</div>}

          {!loading && patientHits.length === 0 && orderHits.length === 0 && (
            <div className="px-3 py-3 text-xs text-ink-soft">
              Không thấy kết quả. Tên/SĐT cần gõ <strong>đúng và đầy đủ</strong>; mã khách/mã đơn tìm một phần.
            </div>
          )}

          {patientHits.length > 0 && (
            <div className="py-1">
              <div className="field-label px-3 py-1">Bệnh nhân</div>
              {patientHits.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => go(`/benh-nhan/${p.id}`)}
                  className="flex w-full items-center justify-between gap-2 rounded px-3 py-1.5 text-left hover:bg-surface-sunk"
                >
                  <span className="truncate text-ink">{fullName(p)}</span>
                  <span className="tabular shrink-0 text-xs text-ink-faint">{p.mrn}</span>
                </button>
              ))}
            </div>
          )}

          {orderHits.length > 0 && (
            <div className="py-1">
              <div className="field-label px-3 py-1">Đơn / hoá đơn</div>
              {orderHits.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => go(`/benh-nhan/${o.patientId}`)}
                  className="flex w-full items-center justify-between gap-2 rounded px-3 py-1.5 text-left hover:bg-surface-sunk"
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="tabular font-medium text-accent">{o.code}</span>
                    <span className="tabular text-xs text-ink-faint">{o.patientMrn}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular text-xs text-ink-soft">{vnd(o.totalVnd)}</span>
                    <Badge tone="neutral">{ORDER_STATUS_VI[o.status] ?? o.status}</Badge>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
