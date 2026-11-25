import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  fetchComplaints, getComplaint, createComplaint, updateComplaint,
  COMPLAINT_STATUS_VI, COMPLAINT_STATUS_TONE, COMPLAINT_CATEGORY_VI, COMPLAINT_SEVERITY_VI, COMPLAINT_SEVERITY_TONE,
  COMPLAINT_CATEGORIES, COMPLAINT_SEVERITIES, COMPLAINT_STATUSES,
  type ComplaintStatus,
} from '../lib/complaints';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Alert, Badge, Skeleton, Input, Field } from './ui';
import { DialogShell } from './DialogShell';

const sel = 'h-10 w-full rounded-md border border-rule-strong bg-surface px-2 text-sm text-ink';
const ta = 'w-full rounded-md border border-rule-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint input-focus';

export function ComplaintsTab({ patientId }: { patientId: string }) {
  const canWrite = useAuthStore((s) => s.can)('complaint:write');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['complaints', patientId],
    queryFn: () => fetchComplaints(patientId),
  });

  if (isError) return <Alert>{getErrorMessage(error)}</Alert>;

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex justify-end">
          <Button className="h-8 px-3 text-xs" onClick={() => setCreating(true)}>Ghi khiếu nại</Button>
        </div>
      )}

      {isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : data && data.length > 0 ? (
        <ul className="space-y-2">
          {data.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpenId(c.id)}
                className="plate flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-surface-sunk"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular text-xs font-medium text-accent">{c.code}</span>
                    <span className="truncate text-sm font-medium text-ink">{c.title}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                    <span>{COMPLAINT_CATEGORY_VI[c.category] ?? c.category}</span>
                    <Badge tone={COMPLAINT_SEVERITY_TONE[c.severity] ?? 'neutral'}>{COMPLAINT_SEVERITY_VI[c.severity] ?? c.severity}</Badge>
                    {c.assignedToName && <span>· {c.assignedToName}</span>}
                  </div>
                </div>
                <Badge tone={COMPLAINT_STATUS_TONE[c.status] ?? 'neutral'}>{COMPLAINT_STATUS_VI[c.status] ?? c.status}</Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-sm text-ink-soft">Chưa có khiếu nại nào.</p>
      )}

      {creating && <CreateDialog patientId={patientId} onClose={() => setCreating(false)} />}
      {openId && <DetailDialog complaintId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function CreateDialog({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState('service');
  const [severity, setSeverity] = useState('medium');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');

  const create = useMutation({
    mutationFn: () => createComplaint(patientId, { category, severity, title: title.trim(), detail: detail.trim() || undefined }),
    onSuccess: () => {
      toast.success('Đã ghi khiếu nại');
      void qc.invalidateQueries({ queryKey: ['complaints', patientId] });
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <DialogShell eyebrow="Khiếu nại mới" title="Ghi khiếu nại" onClose={onClose} maxWidth="max-w-lg">
      <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate(); }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Loại">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={sel}>
              {COMPLAINT_CATEGORIES.map((c) => <option key={c} value={c}>{COMPLAINT_CATEGORY_VI[c]}</option>)}
            </select>
          </Field>
          <Field label="Mức độ">
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={sel}>
              {COMPLAINT_SEVERITIES.map((s) => <option key={s} value={s}>{COMPLAINT_SEVERITY_VI[s]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Tiêu đề *" hint="Nhãn ngắn — tránh thông tin sức khoẻ nhạy cảm (nội dung chi tiết sẽ được mã hoá).">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Ví dụ: Phàn nàn thời gian chờ lâu" autoFocus />
        </Field>
        <Field label="Nội dung chi tiết">
          <textarea className={ta} rows={4} value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={4000} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={create.isPending} disabled={!title.trim()}>Lưu</Button>
        </div>
      </form>
    </DialogShell>
  );
}

function DetailDialog({ complaintId, onClose }: { complaintId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const canWrite = useAuthStore((s) => s.can)('complaint:write');
  const { data, isPending, isError, error } = useQuery({ queryKey: ['complaint', complaintId], queryFn: () => getComplaint(complaintId) });
  const [resolution, setResolution] = useState('');

  const refresh = (pid: string) => {
    void qc.invalidateQueries({ queryKey: ['complaint', complaintId] });
    void qc.invalidateQueries({ queryKey: ['complaints', pid] });
  };
  const mutate = useMutation({
    mutationFn: (body: Partial<{ status: ComplaintStatus; resolution: string | null }>) => updateComplaint(complaintId, body),
    onSuccess: (c) => { toast.success('Đã cập nhật'); refresh(c.patientId); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <DialogShell eyebrow={data ? data.code : 'Khiếu nại'} title={data?.title ?? 'Đang tải…'} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4 p-5">
        {isPending ? (
          <Skeleton className="h-40" />
        ) : isError ? (
          <Alert>{getErrorMessage(error)}</Alert>
        ) : data ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={COMPLAINT_STATUS_TONE[data.status] ?? 'neutral'}>{COMPLAINT_STATUS_VI[data.status] ?? data.status}</Badge>
              <Badge tone={COMPLAINT_SEVERITY_TONE[data.severity] ?? 'neutral'}>{COMPLAINT_SEVERITY_VI[data.severity] ?? data.severity}</Badge>
              <span className="text-xs text-ink-soft">{COMPLAINT_CATEGORY_VI[data.category] ?? data.category}</span>
            </div>
            {data.detail && <div className="plate bg-surface-sunk p-3 text-sm text-ink">{data.detail}</div>}
            {data.resolution && (
              <div>
                <div className="field-label">Cách xử lý</div>
                <div className="mt-1 plate bg-surface-sunk p-3 text-sm text-ink">{data.resolution}</div>
              </div>
            )}

            {canWrite && (
              <div className="space-y-3 border-t border-rule pt-4">
                <Field label="Chuyển trạng thái">
                  <div className="flex flex-wrap gap-1.5">
                    {COMPLAINT_STATUSES.filter((s) => s !== data.status).map((s) => (
                      <Button key={s} variant="ghost" className="h-8 px-2.5 text-xs" loading={mutate.isPending}
                        onClick={() => mutate.mutate({ status: s })}>
                        → {COMPLAINT_STATUS_VI[s]}
                      </Button>
                    ))}
                  </div>
                </Field>
                <Field label="Ghi cách xử lý">
                  <textarea className={ta} rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={4000} placeholder={data.resolution ?? ''} />
                  <div className="mt-2 flex justify-end">
                    <Button className="h-8 px-3 text-xs" disabled={!resolution.trim()} loading={mutate.isPending}
                      onClick={() => mutate.mutate({ resolution: resolution.trim() })}>Lưu cách xử lý</Button>
                  </div>
                </Field>
              </div>
            )}
          </>
        ) : null}
      </div>
    </DialogShell>
  );
}
