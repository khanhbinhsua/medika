import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiClient, getErrorMessage } from '../lib/api-client';
import { fetchPatients, fullName } from '../lib/patients';
import { createPlan, createFromTemplate, listTemplates, formatVnd } from '../lib/treatment';
import type { TreatmentPlan } from '../lib/treatment';
import { DialogShell } from './DialogShell';
import { Button, Input, Field, Alert } from './ui';

interface Doctor {
  id: string;
  fullName: string;
}
async function fetchDoctors() {
  const { data } = await apiClient.get<Doctor[]>('/users/doctors');
  return data;
}

const selectCls = 'h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink';

interface ManualStep {
  title: string;
  cost: string;
}

export function NewTreatmentPlanDialog({
  presetPatientId,
  onClose,
  onCreated,
}: {
  presetPatientId?: string;
  onClose: () => void;
  onCreated: (plan: TreatmentPlan) => void;
}) {
  const [mode, setMode] = useState<'template' | 'manual'>('template');
  const [patientId, setPatientId] = useState(presetPatientId ?? '');
  const [doctorId, setDoctorId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [steps, setSteps] = useState<ManualStep[]>([{ title: '', cost: '' }]);
  const [error, setError] = useState<string | null>(null);

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: fetchDoctors });
  const templates = useQuery({ queryKey: ['treatment-templates'], queryFn: listTemplates });
  const patients = useQuery({
    queryKey: ['patients', 1, ''],
    queryFn: () => fetchPatients({ page: 1, pageSize: 50 }),
    enabled: !presetPatientId,
  });

  const selectedTemplate = templates.data?.find((t) => t.id === templateId);

  const mutation = useMutation({
    mutationFn: () => {
      if (mode === 'template') {
        return createFromTemplate({ patientId, doctorId, templateId, ...(title.trim() ? { title: title.trim() } : {}) });
      }
      const cleanSteps = steps
        .filter((s) => s.title.trim())
        .map((s) => ({ title: s.title.trim(), ...(s.cost ? { cost: Number(s.cost) } : {}) }));
      return createPlan({ patientId, doctorId, title: title.trim(), steps: cleanSteps });
    },
    onSuccess: (plan) => {
      toast.success('Đã tạo phác đồ');
      onCreated(plan);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const canSubmit =
    patientId &&
    doctorId &&
    (mode === 'template' ? templateId : title.trim() && steps.some((s) => s.title.trim()));

  return (
    <DialogShell eyebrow="Phác đồ mới" title="Tạo phác đồ điều trị" onClose={onClose} maxWidth="max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
        className="space-y-4 p-5"
      >
        {error && <Alert>{error}</Alert>}

        <div className="flex gap-1 rounded-lg border border-rule p-1">
          {(['template', 'manual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm ${
                mode === m ? 'bg-accent text-white' : 'text-ink-soft hover:bg-surface-sunk'
              }`}
            >
              {m === 'template' ? 'Từ mẫu có sẵn' : 'Nhập tay'}
            </button>
          ))}
        </div>

        {!presetPatientId && (
          <Field label="Bệnh nhân *">
            <select value={patientId} onChange={(e) => setPatientId(e.target.value)} required className={selectCls}>
              <option value="">— Chọn bệnh nhân —</option>
              {patients.data?.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {fullName(p)} · {p.mrn}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Bác sĩ phụ trách *">
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} required className={selectCls}>
            <option value="">— Chọn bác sĩ —</option>
            {doctors.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
              </option>
            ))}
          </select>
        </Field>

        {mode === 'template' ? (
          <>
            <Field label="Mẫu phác đồ *">
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} required className={selectCls}>
                <option value="">— Chọn mẫu —</option>
                {templates.data
                  ?.filter((t) => t.active)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.condition ? ` · ${t.condition}` : ''}
                    </option>
                  ))}
              </select>
            </Field>
            {selectedTemplate && (
              <div className="rounded-lg border border-rule bg-surface-sunk p-3 text-sm">
                <div className="field-label text-ink-soft">Các bước trong mẫu</div>
                <ul className="mt-1.5 space-y-1">
                  {selectedTemplate.steps.map((s) => (
                    <li key={s.stepOrder} className="flex justify-between">
                      <span>
                        {s.stepOrder}. {s.title}
                      </span>
                      <span className="tabular text-ink-soft">{formatVnd(s.estimatedCost)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Field label="Tiêu đề (tuỳ chọn — mặc định lấy tên mẫu)">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Điều trị tuỷ răng 26" />
            </Field>
          </>
        ) : (
          <>
            <Field label="Tiêu đề phác đồ *">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="VD: Điều trị tuỷ răng 26" />
            </Field>
            <div>
              <div className="field-label mb-1.5 text-ink-soft">Các bước điều trị</div>
              <div className="space-y-2">
                {steps.map((s, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={s.title}
                      onChange={(e) => setSteps((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                      placeholder={`Bước ${i + 1}`}
                      className="flex-1"
                    />
                    <Input
                      value={s.cost}
                      onChange={(e) => setSteps((prev) => prev.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))}
                      placeholder="Chi phí"
                      inputMode="numeric"
                      className="tabular w-28"
                    />
                    {steps.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                        className="rounded border border-rule-strong px-2 text-ink-soft hover:bg-surface-sunk"
                        aria-label="Xoá bước"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSteps((prev) => [...prev, { title: '', cost: '' }])}
                className="mt-2 text-sm text-accent hover:underline"
              >
                + Thêm bước
              </button>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-rule pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={!canSubmit}>
            Tạo phác đồ
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
