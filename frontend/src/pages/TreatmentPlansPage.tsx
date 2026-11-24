import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchPatients, fullName } from '../lib/patients';
import {
  listPlans,
  submitPlan,
  approvePlan,
  cancelPlan,
  addStep,
  updateStep,
  planHistory,
  formatVnd,
  PLAN_STATUS_VI,
  STEP_STATUS_VI,
} from '../lib/treatment';
import type { TreatmentPlan, TreatmentPlanStatus } from '../lib/treatment';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Field, Alert, Badge, Skeleton, Input } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { NewTreatmentPlanDialog } from '../components/NewTreatmentPlanDialog';

const selectCls = 'h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink';

const STATUS_TONE: Record<TreatmentPlanStatus, 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'> = {
  draft: 'neutral',
  pending_approval: 'warn',
  active: 'accent',
  completed: 'ok',
  cancelled: 'danger',
};

export function TreatmentPlansPage() {
  const can = useAuthStore((s) => s.can);
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const patients = useQuery({ queryKey: ['patients', 1, ''], queryFn: () => fetchPatients({ page: 1, pageSize: 50 }) });
  const plans = useQuery({
    queryKey: ['treatment-plans', patientId],
    queryFn: () => listPlans(patientId),
    enabled: !!patientId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['treatment-plans', patientId] });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Phác đồ điều trị"
        meta="Kế hoạch điều trị nhiều bước — nội dung lâm sàng được mã hoá"
        action={
          can('treatment:write') && patientId ? (
            <Button onClick={() => setShowCreate(true)}>+ Tạo phác đồ</Button>
          ) : undefined
        }
      />

      <div className="plate p-4">
        <Field label="Chọn bệnh nhân để xem phác đồ">
          <select value={patientId} onChange={(e) => setPatientId(e.target.value)} className={selectCls}>
            <option value="">— Chọn bệnh nhân —</option>
            {patients.data?.data.map((p) => (
              <option key={p.id} value={p.id}>
                {fullName(p)} · {p.mrn}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {!patientId && (
        <div className="plate p-8 text-center text-sm text-ink-soft">Chọn một bệnh nhân để xem danh sách phác đồ điều trị.</div>
      )}

      {patientId && plans.isLoading && <Skeleton className="h-40" />}
      {plans.isError && <Alert>{getErrorMessage(plans.error)}</Alert>}
      {patientId && plans.data?.length === 0 && (
        <div className="plate p-8 text-center text-sm text-ink-soft">Bệnh nhân này chưa có phác đồ nào.</div>
      )}

      <div className="space-y-4">
        {plans.data?.map((plan) => (
          <PlanCard key={plan.id} plan={plan} onChange={invalidate} />
        ))}
      </div>

      {showCreate && (
        <NewTreatmentPlanDialog
          presetPatientId={patientId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function PlanCard({ plan, onChange }: { plan: TreatmentPlan; onChange: () => void }) {
  const can = useAuthStore((s) => s.can);
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [newStepTitle, setNewStepTitle] = useState('');
  const [newStepCost, setNewStepCost] = useState('');

  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      onChange();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const history = useQuery({ queryKey: ['plan-history', plan.id], queryFn: () => planHistory(plan.id), enabled: showHistory });

  const writable = can('treatment:write') && (plan.status === 'draft' || plan.status === 'active' || plan.status === 'pending_approval');
  const terminal = plan.status === 'completed' || plan.status === 'cancelled';

  const doCancel = () => {
    const reason = window.prompt('Lý do huỷ phác đồ:');
    if (reason && reason.trim()) act.mutate(() => cancelPlan(plan.id, reason.trim()).then(() => toast.success('Đã huỷ phác đồ')));
  };

  return (
    <div className="plate overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-left">
          <span className="text-ink-soft">{open ? '▾' : '▸'}</span>
          <div>
            <div className="font-semibold tracking-tight">{plan.title}</div>
            <div className="text-xs text-ink-soft">
              BS. {plan.doctorName} · {formatVnd(plan.totalCost)}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[plan.status]}>{PLAN_STATUS_VI[plan.status]}</Badge>
        </div>
      </div>

      {/* Thanh tiến độ */}
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between text-xs text-ink-soft">
          <span>
            Tiến độ {plan.progress.completed}/{plan.progress.total} bước
          </span>
          <span className="tabular">{plan.progress.percent}%</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-sunk">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${plan.progress.percent}%` }} />
        </div>
      </div>

      {open && (
        <div className="space-y-4 p-4">
          {/* Các bước */}
          <div className="space-y-2">
            {plan.steps.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rule px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm">
                    <span className="tabular text-ink-soft">{s.stepOrder}.</span> {s.title}
                  </div>
                  {s.description && <div className="text-xs text-ink-soft">{s.description}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular text-xs text-ink-soft">{formatVnd(s.cost)}</span>
                  <Badge tone={s.status === 'completed' ? 'ok' : s.status === 'cancelled' ? 'danger' : 'neutral'}>
                    {STEP_STATUS_VI[s.status]}
                  </Badge>
                  {writable && s.status !== 'completed' && s.status !== 'cancelled' && (
                    <button
                      type="button"
                      onClick={() =>
                        act.mutate(() => updateStep(plan.id, s.id, { status: 'completed' }).then(() => toast.success('Đã cập nhật bước')))
                      }
                      className="text-xs text-accent hover:underline"
                    >
                      Hoàn thành
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Thêm bước */}
          {writable && (
            <div className="flex gap-2">
              <Input value={newStepTitle} onChange={(e) => setNewStepTitle(e.target.value)} placeholder="Thêm bước mới…" className="flex-1" />
              <Input
                value={newStepCost}
                onChange={(e) => setNewStepCost(e.target.value)}
                placeholder="Chi phí"
                inputMode="numeric"
                className="tabular w-28"
              />
              <Button
                variant="ghost"
                disabled={!newStepTitle.trim()}
                onClick={() =>
                  act.mutate(() =>
                    addStep(plan.id, { title: newStepTitle.trim(), ...(newStepCost ? { cost: Number(newStepCost) } : {}) }).then(() => {
                      setNewStepTitle('');
                      setNewStepCost('');
                    }),
                  )
                }
              >
                Thêm
              </Button>
            </div>
          )}

          {plan.status === 'cancelled' && plan.cancelReason && (
            <Alert tone="warn">Lý do huỷ: {plan.cancelReason}</Alert>
          )}
          {plan.status === 'active' && plan.approvedByName && (
            <div className="text-xs text-ink-soft">Đã duyệt bởi {plan.approvedByName}</div>
          )}

          {/* Hành động theo trạng thái */}
          {!terminal && (
            <div className="flex flex-wrap gap-2 border-t border-rule pt-3">
              {plan.status === 'draft' && can('treatment:write') && (
                <Button
                  variant="ghost"
                  loading={act.isPending}
                  onClick={() => act.mutate(() => submitPlan(plan.id).then(() => toast.success('Đã gửi duyệt')))}
                >
                  Gửi duyệt
                </Button>
              )}
              {plan.status === 'pending_approval' && can('treatment:approve') && (
                <Button
                  loading={act.isPending}
                  onClick={() => act.mutate(() => approvePlan(plan.id).then(() => toast.success('Đã phê duyệt')))}
                >
                  Phê duyệt
                </Button>
              )}
              {can('treatment:write') && (
                <Button variant="ghost" onClick={doCancel}>
                  Huỷ phác đồ
                </Button>
              )}
              <button type="button" onClick={() => setShowHistory((v) => !v)} className="ml-auto text-xs text-accent hover:underline">
                {showHistory ? 'Ẩn lịch sử' : 'Lịch sử thay đổi'}
              </button>
            </div>
          )}
          {terminal && (
            <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-xs text-accent hover:underline">
              {showHistory ? 'Ẩn lịch sử' : 'Lịch sử thay đổi'}
            </button>
          )}

          {showHistory && (
            <div className="rounded-lg border border-rule bg-surface-sunk p-3 text-xs">
              {history.isLoading && <Skeleton className="h-16" />}
              {history.data?.length === 0 && <div className="text-ink-soft">Chưa có lịch sử.</div>}
              <ul className="space-y-1">
                {history.data?.map((h, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>
                      <span className="text-accent">{h.action}</span>
                      {h.detail ? ` · ${h.detail}` : ''}
                    </span>
                    <span className="tabular text-ink-soft">{new Date(h.at).toLocaleString('vi-VN')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
