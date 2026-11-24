import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  listSegments,
  createSegment,
  deleteSegment,
  previewCriteria,
  previewSegment,
  listCampaigns,
  createCampaign,
  sendCampaign,
  campaignReport,
  dispatchBirthday,
  dispatchCare,
  retention,
  CAMPAIGN_STATUS_VI,
} from '../lib/marketing';
import type { SegmentCriteria, Campaign } from '../lib/marketing';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Field, Alert, Badge, Skeleton, Input } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { DialogShell } from '../components/DialogShell';

const selectCls = 'h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink';

function criteriaSummary(c: SegmentCriteria): string {
  const parts: string[] = [];
  if (c.gender) parts.push(`Giới tính: ${c.gender}`);
  if (c.minVisits != null) parts.push(`≥ ${c.minVisits} lần khám`);
  if (c.maxVisits != null) parts.push(`≤ ${c.maxVisits} lần khám`);
  if (c.conditionLike) parts.push(`Bệnh lý: ${c.conditionLike}`);
  if (c.inactiveSinceDays != null) parts.push(`Không khám ${c.inactiveSinceDays} ngày`);
  if (c.newWithinDays != null) parts.push(`Mới trong ${c.newWithinDays} ngày`);
  if (c.minTotalSpend != null) parts.push(`Chi ≥ ${c.minTotalSpend.toLocaleString('vi-VN')}₫`);
  if (c.maxTotalSpend != null) parts.push(`Chi ≤ ${c.maxTotalSpend.toLocaleString('vi-VN')}₫`);
  return parts.length ? parts.join(' · ') : 'Tất cả bệnh nhân';
}

export function MarketingPage() {
  const [tab, setTab] = useState<'segments' | 'campaigns' | 'reports'>('campaigns');
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Marketing & CSKH" meta="Nhóm khách hàng · chiến dịch · chăm sóc — chỉ gửi cho người đã đồng ý marketing" />
      <div className="flex gap-1 rounded-lg border border-rule p-1">
        {([
          ['campaigns', 'Chiến dịch'],
          ['segments', 'Nhóm khách hàng'],
          ['reports', 'Báo cáo & CSKH'],
        ] as const).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-accent text-white' : 'text-ink-soft hover:bg-surface-sunk'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'segments' && <SegmentsTab />}
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}

// ── Nhóm khách hàng ─────────────────────────────────────────────────────────
function SegmentsTab() {
  const can = useAuthStore((s) => s.can);
  const qc = useQueryClient();
  const segments = useQuery({ queryKey: ['segments'], queryFn: listSegments });
  const [showCreate, setShowCreate] = useState(false);

  const del = useMutation({
    mutationFn: (id: string) => deleteSegment(id),
    onSuccess: () => {
      toast.success('Đã xoá nhóm');
      void qc.invalidateQueries({ queryKey: ['segments'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="space-y-4">
      {can('marketing:manage') && (
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate(true)}>+ Tạo nhóm</Button>
        </div>
      )}
      {segments.isLoading && <Skeleton className="h-32" />}
      {segments.data?.length === 0 && <div className="plate p-8 text-center text-sm text-ink-soft">Chưa có nhóm khách hàng nào.</div>}
      {segments.data?.map((s) => (
        <div key={s.id} className="plate flex flex-wrap items-center justify-between gap-2 p-4">
          <div className="min-w-0">
            <div className="font-semibold tracking-tight">{s.name}</div>
            <div className="text-xs text-ink-soft">{criteriaSummary(s.criteria)}</div>
          </div>
          <div className="flex items-center gap-3">
            <MemberCount segmentId={s.id} />
            {can('marketing:manage') && (
              <button
                type="button"
                onClick={() => window.confirm(`Xoá nhóm "${s.name}"?`) && del.mutate(s.id)}
                className="text-xs text-danger hover:underline"
              >
                Xoá
              </button>
            )}
          </div>
        </div>
      ))}
      {showCreate && <CreateSegmentDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function MemberCount({ segmentId }: { segmentId: string }) {
  const q = useQuery({ queryKey: ['segment-preview', segmentId], queryFn: () => previewSegment(segmentId) });
  if (q.isLoading) return <span className="text-xs text-ink-soft">…</span>;
  return <Badge tone="accent">{q.data?.count ?? 0} bệnh nhân</Badge>;
}

function CreateSegmentDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [c, setC] = useState<SegmentCriteria>({});
  const [preview, setPreview] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const num = (v: string) => (v === '' ? undefined : Number(v));
  const doPreview = useMutation({
    mutationFn: () => previewCriteria(c),
    onSuccess: (r) => setPreview(r.count),
    onError: (err) => setError(getErrorMessage(err)),
  });
  const create = useMutation({
    mutationFn: () => createSegment({ name: name.trim(), criteria: c }),
    onSuccess: () => {
      toast.success('Đã tạo nhóm');
      void qc.invalidateQueries({ queryKey: ['segments'] });
      onClose();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  return (
    <DialogShell eyebrow="Nhóm mới" title="Tạo nhóm khách hàng" onClose={onClose} maxWidth="max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate();
        }}
        className="space-y-4 p-5"
      >
        {error && <Alert>{error}</Alert>}
        <Field label="Tên nhóm *">
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="VD: Khách VIP · Cần tái khám" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Giới tính">
            <select value={c.gender ?? ''} onChange={(e) => setC({ ...c, gender: e.target.value || undefined })} className={selectCls}>
              <option value="">Bất kỳ</option>
              <option value="male">Nam</option>
              <option value="female">Nữ</option>
              <option value="other">Khác</option>
            </select>
          </Field>
          <Field label="Bệnh lý (chứa)">
            <Input value={c.conditionLike ?? ''} onChange={(e) => setC({ ...c, conditionLike: e.target.value || undefined })} placeholder="VD: tiểu đường / E11" />
          </Field>
          <Field label="Số lần khám tối thiểu">
            <Input inputMode="numeric" value={c.minVisits ?? ''} onChange={(e) => setC({ ...c, minVisits: num(e.target.value) })} className="tabular" />
          </Field>
          <Field label="Số lần khám tối đa">
            <Input inputMode="numeric" value={c.maxVisits ?? ''} onChange={(e) => setC({ ...c, maxVisits: num(e.target.value) })} className="tabular" />
          </Field>
          <Field label="Không khám trong (ngày)" hint="Win-back">
            <Input inputMode="numeric" value={c.inactiveSinceDays ?? ''} onChange={(e) => setC({ ...c, inactiveSinceDays: num(e.target.value) })} className="tabular" />
          </Field>
          <Field label="Bệnh nhân mới trong (ngày)">
            <Input inputMode="numeric" value={c.newWithinDays ?? ''} onChange={(e) => setC({ ...c, newWithinDays: num(e.target.value) })} className="tabular" />
          </Field>
          <Field label="Tổng chi tiêu tối thiểu (₫)" hint="Khách VIP">
            <Input inputMode="numeric" value={c.minTotalSpend ?? ''} onChange={(e) => setC({ ...c, minTotalSpend: num(e.target.value) })} className="tabular" />
          </Field>
          <Field label="Tổng chi tiêu tối đa (₫)">
            <Input inputMode="numeric" value={c.maxTotalSpend ?? ''} onChange={(e) => setC({ ...c, maxTotalSpend: num(e.target.value) })} className="tabular" />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" loading={doPreview.isPending} onClick={() => doPreview.mutate()}>
            Xem trước số lượng
          </Button>
          {preview != null && <span className="text-sm text-accent">≈ {preview} bệnh nhân khớp</span>}
        </div>
        <div className="flex justify-end gap-2 border-t border-rule pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
            Tạo nhóm
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

// ── Chiến dịch ──────────────────────────────────────────────────────────────
function CampaignsTab() {
  const can = useAuthStore((s) => s.can);
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: listCampaigns });
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-4">
      {can('marketing:manage') && (
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate(true)}>+ Tạo chiến dịch</Button>
        </div>
      )}
      {campaigns.isLoading && <Skeleton className="h-32" />}
      {campaigns.data?.length === 0 && <div className="plate p-8 text-center text-sm text-ink-soft">Chưa có chiến dịch nào.</div>}
      {campaigns.data?.map((c) => <CampaignCard key={c.id} campaign={c} />)}
      {showCreate && <CreateCampaignDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const can = useAuthStore((s) => s.can);
  const qc = useQueryClient();
  const [report, setReport] = useState(false);

  const send = useMutation({
    mutationFn: () => sendCampaign(campaign.id),
    onSuccess: (r) => {
      toast.success(`Đã gửi ${r.sent} · bỏ qua ${r.skippedNoConsent} (chưa đồng ý)`);
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const rep = useQuery({ queryKey: ['campaign-report', campaign.id], queryFn: () => campaignReport(campaign.id), enabled: report });

  return (
    <div className="plate p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold tracking-tight">{campaign.name}</div>
          <div className="truncate text-xs text-ink-soft">{campaign.message}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={campaign.status === 'sent' ? 'ok' : campaign.status === 'sending' ? 'warn' : 'neutral'}>
            {CAMPAIGN_STATUS_VI[campaign.status]}
          </Badge>
          {can('marketing:manage') && campaign.status !== 'sent' && (
            <Button loading={send.isPending} onClick={() => send.mutate()}>
              Gửi
            </Button>
          )}
          {campaign.status === 'sent' && (
            <button type="button" onClick={() => setReport((v) => !v)} className="text-xs text-accent hover:underline">
              {report ? 'Ẩn' : 'Báo cáo'}
            </button>
          )}
        </div>
      </div>
      {report && rep.data && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniStat label="Gửi tới" value={rep.data.total} />
          <MiniStat label="Đã nhận" value={`${rep.data.delivered} (${rep.data.deliveryRate}%)`} />
          <MiniStat label="Đã đọc" value={`${rep.data.read} (${rep.data.readRate}%)`} />
          <MiniStat label="Thất bại" value={rep.data.failed} />
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-rule bg-surface-sunk p-2.5">
      <div className="field-label text-ink-soft">{label}</div>
      <div className="tabular mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function CreateCampaignDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const segments = useQuery({ queryKey: ['segments'], queryFn: listSegments });
  const [name, setName] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createCampaign({ name: name.trim(), segmentId, message: message.trim() }),
    onSuccess: () => {
      toast.success('Đã tạo chiến dịch');
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      onClose();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  return (
    <DialogShell eyebrow="Chiến dịch mới" title="Tạo chiến dịch" onClose={onClose} maxWidth="max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate();
        }}
        className="space-y-4 p-5"
      >
        {error && <Alert>{error}</Alert>}
        <Field label="Tên chiến dịch *">
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="VD: Ưu đãi tháng 9" />
        </Field>
        <Field label="Nhóm khách hàng *">
          <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} required className={selectCls}>
            <option value="">— Chọn nhóm —</option>
            {segments.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nội dung *" hint="Văn bản quảng bá chung — KHÔNG chứa thông tin bệnh nhân. Lời chào {{ten}} tự thêm.">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            required
            className="w-full rounded border border-rule-strong bg-surface px-3 py-2 text-sm text-ink"
            placeholder="VD: phòng khám giảm 20% dịch vụ trong tháng này…"
          />
        </Field>
        <div className="flex justify-end gap-2 border-t border-rule pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!name.trim() || !segmentId || !message.trim()}>
            Tạo (chưa gửi)
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

// ── Báo cáo & CSKH ──────────────────────────────────────────────────────────
function ReportsTab() {
  const can = useAuthStore((s) => s.can);
  const ret = useQuery({ queryKey: ['retention'], queryFn: retention });
  const [bdayMsg, setBdayMsg] = useState('Chúc mừng sinh nhật! Phòng khám tặng bạn ưu đãi đặc biệt trong tháng.');

  const bday = useMutation({
    mutationFn: () => dispatchBirthday(bdayMsg.trim()),
    onSuccess: (r) => toast.success(`Sinh nhật hôm nay: ${r.matched} người · đã gửi ${r.sent}`),
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const care = useMutation({
    mutationFn: () => dispatchCare(),
    onSuccess: (r) => toast.success(`Chăm sóc hậu điều trị: gửi ${r.sent}/${r.processed}`),
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <div className="plate p-4">
        <div className="mb-3 font-semibold tracking-tight">Tỷ lệ quay lại (retention)</div>
        {ret.isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Tổng bệnh nhân" value={ret.data?.totalPatients ?? 0} />
            <MiniStat label="Đã từng khám" value={ret.data?.visited ?? 0} />
            <MiniStat label="Quay lại (≥2)" value={ret.data?.returned ?? 0} />
            <MiniStat label="Tỷ lệ quay lại" value={`${ret.data?.retentionRate ?? 0}%`} />
          </div>
        )}
      </div>

      {can('marketing:manage') && (
        <>
          <div className="plate space-y-3 p-4">
            <div className="font-semibold tracking-tight">Chúc mừng sinh nhật hôm nay</div>
            <textarea
              value={bdayMsg}
              onChange={(e) => setBdayMsg(e.target.value)}
              rows={2}
              className="w-full rounded border border-rule-strong bg-surface px-3 py-2 text-sm text-ink"
            />
            <div className="flex items-center gap-3">
              <Button loading={bday.isPending} onClick={() => bday.mutate()}>
                Gửi lời chúc sinh nhật
              </Button>
              <span className="text-xs text-ink-soft">Chỉ gửi cho người đã đồng ý nhận marketing.</span>
            </div>
          </div>

          <div className="plate flex items-center justify-between gap-2 p-4">
            <div>
              <div className="font-semibold tracking-tight">Chăm sóc hậu điều trị</div>
              <div className="text-xs text-ink-soft">Gửi các lời chăm sóc đã tới hạn (tự tạo khi phác đồ hoàn thành).</div>
            </div>
            <Button variant="ghost" loading={care.isPending} onClick={() => care.mutate()}>
              Điều phối gửi
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
