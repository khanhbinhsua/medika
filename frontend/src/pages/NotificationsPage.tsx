import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchPatients, fullName } from '../lib/patients';
import {
  listTemplates,
  updateTemplate,
  listForPatient,
  KIND_VI,
  CHANNEL_VI,
  NOTIFY_STATUS_VI,
} from '../lib/notifications';
import type { NotificationTemplate, NotificationKind } from '../lib/notifications';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Field, Alert, Badge, Skeleton, Input } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { DialogShell } from '../components/DialogShell';

const selectCls = 'h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink';

export function NotificationsPage() {
  const [tab, setTab] = useState<'templates' | 'history'>('templates');
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Thông báo đa kênh" meta="Zalo · SMS · Email — template & lịch sử gửi (không lưu nội dung PHI)" />
      <div className="flex gap-1 rounded-lg border border-rule p-1">
        {(['templates', 'history'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-accent text-white' : 'text-ink-soft hover:bg-surface-sunk'}`}
          >
            {t === 'templates' ? 'Mẫu thông báo' : 'Lịch sử theo bệnh nhân'}
          </button>
        ))}
      </div>
      {tab === 'templates' ? <TemplatesTab /> : <HistoryTab />}
    </div>
  );
}

function TemplatesTab() {
  const can = useAuthStore((s) => s.can);
  const templates = useQuery({ queryKey: ['notification-templates'], queryFn: listTemplates });
  const [editing, setEditing] = useState<NotificationTemplate | null>(null);

  if (templates.isLoading) return <Skeleton className="h-64" />;
  if (templates.isError) return <Alert>{getErrorMessage(templates.error)}</Alert>;

  // Gom theo kind.
  const byKind = new Map<NotificationKind, NotificationTemplate[]>();
  for (const t of templates.data ?? []) {
    const arr = byKind.get(t.kind) ?? [];
    arr.push(t);
    byKind.set(t.kind, arr);
  }

  return (
    <div className="space-y-4">
      {[...byKind.entries()].map(([kind, list]) => (
        <div key={kind} className="plate p-4">
          <div className="mb-2 font-semibold tracking-tight">{KIND_VI[kind]}</div>
          <div className="space-y-2">
            {list.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rule px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">{CHANNEL_VI[t.channel]}</Badge>
                    {!t.active && <Badge tone="neutral">Tắt</Badge>}
                    <span className="truncate text-sm text-ink-soft">{t.content}</span>
                  </div>
                </div>
                {can('notification:manage') && (
                  <button type="button" onClick={() => setEditing(t)} className="text-xs text-accent hover:underline">
                    Sửa
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-ink-soft">
        Dùng biến <code className="rounded bg-surface-sunk px-1">{'{{ten}}'}</code> (tên bệnh nhân),{' '}
        <code className="rounded bg-surface-sunk px-1">{'{{thoi_gian}}'}</code>,{' '}
        <code className="rounded bg-surface-sunk px-1">{'{{noi_dung}}'}</code>… — ghép lúc gửi, không lưu vào DB.
      </p>
      {editing && <EditTemplateDialog template={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditTemplateDialog({ template, onClose }: { template: NotificationTemplate; onClose: () => void }) {
  const qc = useQueryClient();
  const [content, setContent] = useState(template.content);
  const [subject, setSubject] = useState(template.subject ?? '');
  const [zaloTemplateId, setZaloTemplateId] = useState(template.zaloTemplateId ?? '');
  const [active, setActive] = useState(template.active);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      updateTemplate(template.id, {
        content,
        subject: template.channel === 'email' ? subject : null,
        zaloTemplateId: template.channel === 'zalo' ? zaloTemplateId || null : null,
        active,
      }),
    onSuccess: () => {
      toast.success('Đã cập nhật template');
      void qc.invalidateQueries({ queryKey: ['notification-templates'] });
      onClose();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  return (
    <DialogShell eyebrow={`${KIND_VI[template.kind]} · ${CHANNEL_VI[template.channel]}`} title="Sửa template" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
        className="space-y-4 p-5"
      >
        {error && <Alert>{error}</Alert>}
        {template.channel === 'email' && (
          <Field label="Tiêu đề email">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
        )}
        <Field label="Nội dung (có placeholder {{...}})">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="w-full rounded border border-rule-strong bg-surface px-3 py-2 text-sm text-ink"
          />
        </Field>
        {template.channel === 'zalo' && (
          <Field label="Zalo template_id (đã duyệt với Zalo OA)">
            <Input value={zaloTemplateId} onChange={(e) => setZaloTemplateId(e.target.value)} placeholder="ZNS_..." />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Đang kích hoạt
        </label>
        <div className="flex justify-end gap-2 border-t border-rule pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Lưu
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

function HistoryTab() {
  const [patientId, setPatientId] = useState('');
  const patients = useQuery({ queryKey: ['patients', 1, ''], queryFn: () => fetchPatients({ page: 1, pageSize: 50 }) });
  const rows = useQuery({ queryKey: ['notifications', patientId], queryFn: () => listForPatient(patientId), enabled: !!patientId });

  return (
    <div className="space-y-4">
      <div className="plate p-4">
        <Field label="Chọn bệnh nhân">
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
      {patientId && rows.isLoading && <Skeleton className="h-32" />}
      {patientId && rows.data?.length === 0 && <div className="plate p-8 text-center text-sm text-ink-soft">Chưa có thông báo nào.</div>}
      {rows.data && rows.data.length > 0 && (
        <div className="plate divide-y divide-rule">
          {rows.data.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <Badge tone="neutral">{KIND_VI[r.kind]}</Badge>
                {r.channelSent && <span className="text-xs text-ink-soft">{CHANNEL_VI[r.channelSent]}</span>}
              </div>
              <div className="flex items-center gap-3">
                {r.lastError && <span className="text-xs text-danger">{r.lastError}</span>}
                <Badge tone={r.status === 'read' || r.status === 'sent' ? 'ok' : r.status === 'failed' ? 'danger' : 'neutral'}>
                  {NOTIFY_STATUS_VI[r.status]}
                </Badge>
                <span className="tabular text-xs text-ink-soft">{new Date(r.scheduledAt).toLocaleString('vi-VN')}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
