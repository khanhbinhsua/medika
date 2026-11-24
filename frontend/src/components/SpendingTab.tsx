import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  fetchSummary,
  fetchTransactions,
  addTransaction,
  deleteTransaction,
  CATEGORY_VI,
  CATEGORIES,
  TIER_TONE,
  vnd,
} from '../lib/spending';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Field, Input, Alert, Badge, Skeleton } from './ui';

const selectCls = 'h-9 w-full rounded border border-rule-strong bg-surface px-2 text-sm text-ink';
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('vi-VN') : '—');

export function SpendingTab({ patientId }: { patientId: string }) {
  const can = useAuthStore((s) => s.can);
  const qc = useQueryClient();
  const canWrite = can('spending:write');

  const summary = useQuery({ queryKey: ['spending-summary', patientId], queryFn: () => fetchSummary(patientId) });
  const txns = useQuery({ queryKey: ['spending-txns', patientId], queryFn: () => fetchTransactions(patientId) });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['spending-summary', patientId] });
    void qc.invalidateQueries({ queryKey: ['spending-txns', patientId] });
  };

  const del = useMutation({
    mutationFn: (id: string) => deleteTransaction(id),
    onSuccess: () => {
      toast.success('Đã xoá khoản chi');
      invalidate();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-4">
      {/* Tổng hợp + hạng VIP */}
      {summary.isLoading ? (
        <Skeleton className="h-20" />
      ) : summary.isError ? (
        <Alert>{getErrorMessage(summary.error)}</Alert>
      ) : summary.data ? (
        <div className="rounded-lg border border-rule bg-surface-sunk p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="field-label text-ink-soft">Tổng chi tiêu</div>
              <div className="tabular mt-0.5 text-2xl font-semibold text-accent">{vnd(summary.data.total)}</div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div>
                <div className="field-label text-ink-soft">Hạng khách</div>
                <Badge tone={TIER_TONE[summary.data.tier.code] ?? 'neutral'}>{summary.data.tier.name}</Badge>
              </div>
              <div>
                <div className="field-label text-ink-soft">Số lần</div>
                <div className="tabular">{summary.data.count}</div>
              </div>
              <div>
                <div className="field-label text-ink-soft">Gần nhất</div>
                <div className="tabular">{fmtDate(summary.data.lastAt)}</div>
              </div>
            </div>
          </div>
          {summary.data.byCategory.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {summary.data.byCategory.map((c) => (
                <span key={c.category} className="rounded border border-rule px-2 py-1 text-xs text-ink-soft">
                  {CATEGORY_VI[c.category] ?? c.category}: <span className="tabular text-ink">{vnd(c.total)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {canWrite && <AddForm patientId={patientId} onDone={invalidate} />}

      {/* Danh sách khoản chi */}
      {txns.isLoading ? (
        <Skeleton className="h-24" />
      ) : txns.isError ? (
        <Alert>{getErrorMessage(txns.error)}</Alert>
      ) : txns.data && txns.data.length > 0 ? (
        <div className="divide-y divide-rule rounded-lg border border-rule">
          {txns.data.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="tabular text-ink-soft">{fmtDate(t.occurredAt)}</span>
                  <Badge tone="neutral">{CATEGORY_VI[t.category] ?? t.category}</Badge>
                  {t.source === 'import' && <span className="text-[10px] uppercase text-ink-faint">nhập</span>}
                </div>
                {t.note && <div className="truncate text-xs text-ink-soft">{t.note}</div>}
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular font-medium">{vnd(t.amount)}</span>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => window.confirm('Xoá khoản chi này?') && del.mutate(t.id)}
                    className="text-xs text-danger hover:underline"
                  >
                    Xoá
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-ink-soft">Chưa có khoản chi nào.</p>
      )}
    </div>
  );
}

function AddForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('kham');
  const [note, setNote] = useState('');

  const add = useMutation({
    mutationFn: () => addTransaction(patientId, { occurredAt, amount: Number(amount), category, note: note.trim() || undefined }),
    onSuccess: () => {
      toast.success('Đã ghi khoản chi');
      setAmount('');
      setNote('');
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const valid = amount.trim() !== '' && Number(amount) >= 0 && !Number.isNaN(Number(amount));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) add.mutate();
      }}
      className="grid grid-cols-2 gap-3 rounded-lg border border-rule p-3 sm:grid-cols-5 sm:items-end"
    >
      <Field label="Ngày">
        <Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
      </Field>
      <Field label="Số tiền (₫)">
        <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" />
      </Field>
      <Field label="Loại">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_VI[c]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Ghi chú">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tuỳ chọn" />
      </Field>
      <Button type="submit" loading={add.isPending} disabled={!valid}>
        Ghi khoản chi
      </Button>
    </form>
  );
}
