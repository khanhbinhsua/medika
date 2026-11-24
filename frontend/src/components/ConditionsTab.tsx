import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  fetchConditions,
  addCondition,
  deleteCondition,
  updateCondition,
  addAllergy,
  deleteAllergy,
  CONDITION_STATUS_VI,
  CONDITION_STATUSES,
  SEVERITY_VI,
  SEVERITIES,
  SEVERITY_TONE,
  STATUS_TONE,
} from '../lib/conditions';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Field, Input, Alert, Badge, Skeleton } from './ui';
import { Icd10Combobox } from './Icd10Combobox';

const selectCls = 'h-9 w-full rounded border border-rule-strong bg-surface px-2 text-sm text-ink';
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('vi-VN') : null);

export function ConditionsTab({ patientId }: { patientId: string }) {
  const can = useAuthStore((s) => s.can);
  const qc = useQueryClient();
  const canWrite = can('condition:write');
  const data = useQuery({ queryKey: ['conditions', patientId], queryFn: () => fetchConditions(patientId) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['conditions', patientId] });

  const delCond = useMutation({
    mutationFn: (id: string) => deleteCondition(id),
    onSuccess: () => { toast.success('Đã xoá bệnh lý'); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateCondition(id, { status }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const delAllergy = useMutation({
    mutationFn: (id: string) => deleteAllergy(id),
    onSuccess: () => { toast.success('Đã xoá dị ứng'); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (data.isLoading) return <Skeleton className="h-40" />;
  if (data.isError) return <Alert>{getErrorMessage(data.error)}</Alert>;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Bệnh lý */}
      <section>
        <h3 className="field-label mb-2">Bệnh lý</h3>
        {canWrite && <ConditionForm patientId={patientId} onDone={invalidate} />}
        <div className="mt-3 space-y-2">
          {data.data!.conditions.length === 0 ? (
            <p className="text-sm text-ink-soft">Chưa ghi nhận bệnh lý nào.</p>
          ) : (
            data.data!.conditions.map((c) => (
              <div key={c.id} className="rounded-lg border border-rule p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.condition}</span>
                      {c.icd10Code && <span className="tabular text-xs text-ink-soft">{c.icd10Code}</span>}
                      <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{CONDITION_STATUS_VI[c.status] ?? c.status}</Badge>
                    </div>
                    {c.onsetDate && <div className="text-xs text-ink-soft">Khởi phát: {fmtDate(c.onsetDate)}</div>}
                    {c.notes && <div className="mt-0.5 text-sm text-ink-soft">{c.notes}</div>}
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        value={c.status}
                        onChange={(e) => setStatus.mutate({ id: c.id, status: e.target.value })}
                        className="h-7 rounded border border-rule-strong bg-surface px-1 text-xs text-ink"
                      >
                        {CONDITION_STATUSES.map((s) => (
                          <option key={s} value={s}>{CONDITION_STATUS_VI[s]}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => window.confirm('Xoá bệnh lý này?') && delCond.mutate(c.id)} className="text-xs text-danger hover:underline">
                        Xoá
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Dị ứng */}
      <section>
        <h3 className="field-label mb-2">Dị ứng</h3>
        {canWrite && <AllergyForm patientId={patientId} onDone={invalidate} />}
        <div className="mt-3 space-y-2">
          {data.data!.allergies.length === 0 ? (
            <p className="text-sm text-ink-soft">Chưa ghi nhận dị ứng nào.</p>
          ) : (
            data.data!.allergies.map((a) => (
              <div key={a.id} className="rounded-lg border border-rule p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{a.allergyName}</span>
                      <Badge tone={SEVERITY_TONE[a.severity] ?? 'neutral'}>{SEVERITY_VI[a.severity] ?? a.severity}</Badge>
                    </div>
                    {a.reaction && <div className="text-xs text-ink-soft">Phản ứng: {a.reaction}</div>}
                    {a.notes && <div className="mt-0.5 text-sm text-ink-soft">{a.notes}</div>}
                  </div>
                  {canWrite && (
                    <button type="button" onClick={() => window.confirm('Xoá dị ứng này?') && delAllergy.mutate(a.id)} className="shrink-0 text-xs text-danger hover:underline">
                      Xoá
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ConditionForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [condition, setCondition] = useState('');
  const [icd10Code, setIcd10] = useState('');
  const [status, setStatus] = useState('active');
  const [notes, setNotes] = useState('');

  const add = useMutation({
    mutationFn: () =>
      addCondition(patientId, {
        condition: condition.trim(),
        icd10Code: icd10Code.trim() || undefined,
        status,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => { toast.success('Đã thêm bệnh lý'); setCondition(''); setIcd10(''); setNotes(''); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (condition.trim()) add.mutate(); }}
      className="space-y-2 rounded-lg border border-rule p-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Tên bệnh lý"><Input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="VD: Đái tháo đường" /></Field>
        <Field label="Mã ICD-10" hint="Gõ mã hoặc tên để tìm">
          <Icd10Combobox
            value={icd10Code}
            onChange={setIcd10}
            onPick={(it) => { if (!condition.trim()) setCondition(it.name); }}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Trạng thái">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            {CONDITION_STATUSES.map((s) => <option key={s} value={s}>{CONDITION_STATUS_VI[s]}</option>)}
          </select>
        </Field>
        <Field label="Ghi chú"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Tuỳ chọn" /></Field>
      </div>
      <Button type="submit" loading={add.isPending} disabled={!condition.trim()} className="w-full">Thêm bệnh lý</Button>
    </form>
  );
}

function AllergyForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [allergyName, setName] = useState('');
  const [reaction, setReaction] = useState('');
  const [severity, setSeverity] = useState('moderate');
  const [notes, setNotes] = useState('');

  const add = useMutation({
    mutationFn: () =>
      addAllergy(patientId, {
        allergyName: allergyName.trim(),
        reaction: reaction.trim() || undefined,
        severity,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => { toast.success('Đã thêm dị ứng'); setName(''); setReaction(''); setNotes(''); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (allergyName.trim()) add.mutate(); }}
      className="space-y-2 rounded-lg border border-rule p-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Dị nguyên"><Input value={allergyName} onChange={(e) => setName(e.target.value)} placeholder="VD: Penicillin" /></Field>
        <Field label="Mức độ">
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={selectCls}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_VI[s]}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Phản ứng"><Input value={reaction} onChange={(e) => setReaction(e.target.value)} placeholder="VD: Nổi mề đay" /></Field>
        <Field label="Ghi chú"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Tuỳ chọn" /></Field>
      </div>
      <Button type="submit" loading={add.isPending} disabled={!allergyName.trim()} className="w-full">Thêm dị ứng</Button>
    </form>
  );
}
