import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchPatients, fullName } from '../lib/patients';
import {
  listSurveys,
  createSurvey,
  updateSurvey,
  inviteSurvey,
  dispatchAuto,
  surveyReport,
  surveyTrend,
  surveyNegative,
  SURVEY_TYPE_VI,
  SURVEY_STATUS_VI,
} from '../lib/surveys';
import type { Survey, SurveyType, SurveyStatus, SurveyQuestion } from '../lib/surveys';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Field, Alert, Badge, Skeleton, Input } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { DialogShell } from '../components/DialogShell';
import { SurveyFormRenderer } from '../components/SurveyFormRenderer';

const selectCls = 'h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink';
const STATUS_TONE: Record<SurveyStatus, 'neutral' | 'accent' | 'ok'> = { draft: 'neutral', active: 'accent', closed: 'ok' };

export function SurveysPage() {
  const can = useAuthStore((s) => s.can);
  const surveys = useQuery({ queryKey: ['surveys'], queryFn: listSurveys });
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Khảo sát hài lòng"
        meta="NPS · CSAT — điểm để tổng hợp, góp ý được mã hoá"
        action={can('survey:manage') ? <Button onClick={() => setShowCreate(true)}>+ Tạo khảo sát</Button> : undefined}
      />
      {surveys.isLoading && <Skeleton className="h-40" />}
      {surveys.isError && <Alert>{getErrorMessage(surveys.error)}</Alert>}
      {surveys.data?.length === 0 && <div className="plate p-8 text-center text-sm text-ink-soft">Chưa có khảo sát nào.</div>}
      <div className="space-y-4">
        {surveys.data?.map((s) => <SurveyCard key={s.id} survey={s} />)}
      </div>
      {showCreate && <CreateSurveyDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function SurveyCard({ survey }: { survey: Survey }) {
  const can = useAuthStore((s) => s.can);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['surveys'] });
  const setStatus = useMutation({
    mutationFn: (status: SurveyStatus) => updateSurvey(survey.id, { status }),
    onSuccess: () => {
      toast.success('Đã cập nhật trạng thái');
      invalidate();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const autoDispatch = useMutation({
    mutationFn: () => dispatchAuto(survey.id, 720),
    onSuccess: (r) => toast.success(`Đã gửi ${r.sent}/${r.candidates} lời mời sau khám`),
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="plate overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-left">
          <span className="text-ink-soft">{open ? '▾' : '▸'}</span>
          <div>
            <div className="font-semibold tracking-tight">{survey.name}</div>
            <div className="text-xs text-ink-soft">{SURVEY_TYPE_VI[survey.type]}</div>
          </div>
        </button>
        <Badge tone={STATUS_TONE[survey.status]}>{SURVEY_STATUS_VI[survey.status]}</Badge>
      </div>

      {open && (
        <div className="space-y-4 p-4">
          {/* Hành động */}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setShowPreview(true)}>
              Xem trước
            </Button>
          </div>
          {can('survey:manage') && (
            <div className="flex flex-wrap gap-2">
              {survey.status === 'draft' && (
                <Button variant="ghost" loading={setStatus.isPending} onClick={() => setStatus.mutate('active')}>
                  Kích hoạt
                </Button>
              )}
              {survey.status === 'active' && (
                <>
                  <Button onClick={() => setShowInvite(true)}>Gửi lời mời</Button>
                  <Button variant="ghost" loading={autoDispatch.isPending} onClick={() => autoDispatch.mutate()}>
                    Gửi tự động sau khám (30 ngày)
                  </Button>
                  <Button variant="ghost" onClick={() => setStatus.mutate('closed')}>
                    Đóng khảo sát
                  </Button>
                </>
              )}
            </div>
          )}
          <ReportBlock surveyId={survey.id} />
        </div>
      )}
      {showInvite && <InviteDialog surveyId={survey.id} onClose={() => setShowInvite(false)} />}
      {showPreview && (
        <PreviewModal name={survey.name} type={survey.type} questions={survey.questions} onClose={() => setShowPreview(false)} />
      )}
    </div>
  );
}

/** Xem trước: render đúng như bệnh nhân thấy (không tương tác, không gửi). */
function PreviewModal({
  name,
  type,
  questions,
  onClose,
}: {
  name: string;
  type: SurveyType;
  questions: SurveyQuestion[];
  onClose: () => void;
}) {
  return (
    <DialogShell eyebrow="Xem trước (như bệnh nhân thấy)" title={name} onClose={onClose} maxWidth="max-w-lg">
      <div className="p-5">
        {questions.length === 0 ? (
          <div className="text-sm text-ink-soft">Khảo sát chưa có câu hỏi.</div>
        ) : (
          <SurveyFormRenderer questions={questions} type={type} answers={{}} onChange={() => {}} disabled />
        )}
        <button
          type="button"
          disabled
          className="mt-6 w-full rounded-lg bg-accent py-3 text-sm font-semibold text-white opacity-60"
        >
          Gửi phản hồi
        </button>
      </div>
    </DialogShell>
  );
}

function ReportBlock({ surveyId }: { surveyId: string }) {
  const report = useQuery({ queryKey: ['survey-report', surveyId], queryFn: () => surveyReport(surveyId) });
  const trend = useQuery({ queryKey: ['survey-trend', surveyId], queryFn: () => surveyTrend(surveyId) });
  const negatives = useQuery({ queryKey: ['survey-negative', surveyId], queryFn: () => surveyNegative(surveyId) });

  if (report.isLoading) return <Skeleton className="h-24" />;
  if (!report.data) return null;
  const r = report.data;
  const o = r.overall;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Phản hồi" value={r.totalResponses} />
        {r.type === 'nps' && <Stat label="NPS" value={o.npsScore ?? '—'} accent />}
        {r.type === 'nps' && <Stat label="Ủng hộ / Phản đối" value={`${o.promoters ?? 0} / ${o.detractors ?? 0}`} />}
        {r.type === 'csat' && <Stat label="Điểm TB" value={o.avgScore ?? '—'} accent />}
        {r.type === 'csat' && <Stat label="Hài lòng" value={o.satisfiedPercent != null ? `${o.satisfiedPercent}%` : '—'} />}
        <Stat label="Tiêu cực" value={r.negativeCount} danger={r.negativeCount > 0} />
      </div>

      {r.byDoctor.length > 0 && (
        <div className="rounded-lg border border-rule">
          <div className="field-label border-b border-rule px-3 py-1.5 text-ink-soft">Theo bác sĩ</div>
          {r.byDoctor.map((d) => (
            <div key={d.doctorId} className="flex justify-between px-3 py-1.5 text-sm">
              <span>{d.doctorName}</span>
              <span className="tabular text-ink-soft">
                {r.type === 'nps' ? `NPS ${d.npsScore ?? '—'}` : `TB ${d.avgScore ?? '—'}`} · {d.total} phản hồi
              </span>
            </div>
          ))}
        </div>
      )}

      {trend.data && trend.data.trend.length > 0 && (
        <div className="rounded-lg border border-rule">
          <div className="field-label border-b border-rule px-3 py-1.5 text-ink-soft">Xu hướng theo tháng</div>
          {trend.data.trend.map((t) => (
            <div key={t.month} className="flex justify-between px-3 py-1.5 text-sm">
              <span className="tabular">{t.month}</span>
              <span className="tabular text-ink-soft">
                {t.count} phản hồi · điểm TB {t.avgScore}
              </span>
            </div>
          ))}
        </div>
      )}

      {negatives.data && negatives.data.length > 0 && (
        <div className="rounded-lg border border-danger/40 bg-danger/5">
          <div className="field-label border-b border-danger/30 px-3 py-1.5 text-danger">Phản hồi tiêu cực cần xử lý</div>
          {negatives.data.map((n) => (
            <div key={n.id} className="px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span className="tabular text-ink-soft">MRN {n.mrn} · điểm {n.score ?? '—'}</span>
                <span className="tabular text-xs text-ink-soft">{new Date(n.submittedAt).toLocaleDateString('vi-VN')}</span>
              </div>
              {n.comment && <div className="mt-0.5 text-ink">{n.comment}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent, danger }: { label: string; value: React.ReactNode; accent?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-rule bg-surface-sunk p-3">
      <div className="field-label text-ink-soft">{label}</div>
      <div className={`tabular mt-0.5 text-xl font-semibold ${danger ? 'text-danger' : accent ? 'text-accent' : ''}`}>{value}</div>
    </div>
  );
}

// Câu hỏi trong trình soạn (dạng chuỗi cho input, chuyển sang API lúc gửi).
interface DraftQuestion {
  id: string;
  text: string;
  type: 'scale' | 'text' | 'choice';
  required: boolean;
  min: string;
  max: string;
  lowLabel: string;
  highLabel: string;
  negativeAtOrBelow: string;
  optionsCsv: string;
}
const blankQuestion = (n: number): DraftQuestion => ({
  id: `q${n}`,
  text: '',
  type: 'scale',
  required: true,
  min: '1',
  max: '5',
  lowLabel: '',
  highLabel: '',
  negativeAtOrBelow: '',
  optionsCsv: '',
});

function draftToQuestion(d: DraftQuestion, isPrimary: boolean): SurveyQuestion {
  const q: SurveyQuestion = { id: d.id, text: d.text.trim(), type: d.type, required: d.required };
  if (d.type === 'scale') {
    q.min = Number(d.min);
    q.max = Number(d.max);
    if (d.lowLabel.trim()) q.lowLabel = d.lowLabel.trim();
    if (d.highLabel.trim()) q.highLabel = d.highLabel.trim();
    if (isPrimary) q.primary = true;
    if (d.negativeAtOrBelow !== '') q.negativeAtOrBelow = Number(d.negativeAtOrBelow);
  }
  if (d.type === 'choice') {
    q.options = d.optionsCsv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return q;
}

function CreateSurveyDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<SurveyType>('nps');
  const [drafts, setDrafts] = useState<DraftQuestion[]>([blankQuestion(1)]);
  const [error, setError] = useState<string | null>(null);
  const [previewQs, setPreviewQs] = useState<SurveyQuestion[] | null>(null);

  // Câu 'scale' đầu tiên là câu điểm chính (đưa vào báo cáo).
  const firstScaleId = drafts.find((d) => d.type === 'scale')?.id;
  const buildQuestions = (): SurveyQuestion[] => drafts.map((d) => draftToQuestion(d, d.id === firstScaleId));

  const mutation = useMutation({
    mutationFn: () => {
      const questions = type === 'custom' ? buildQuestions() : undefined;
      return createSurvey({ name: name.trim(), type, ...(questions ? { questions } : {}) });
    },
    onSuccess: () => {
      toast.success('Đã tạo khảo sát');
      void qc.invalidateQueries({ queryKey: ['surveys'] });
      onClose();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const set = (i: number, patch: Partial<DraftQuestion>) =>
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const customValid = type !== 'custom' || drafts.every((d) => d.text.trim() && (d.type !== 'choice' || d.optionsCsv.trim()));

  return (
    <DialogShell eyebrow="Khảo sát mới" title="Tạo khảo sát" onClose={onClose} maxWidth={type === 'custom' ? 'max-w-2xl' : 'max-w-lg'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
        className="space-y-4 p-5"
      >
        {error && <Alert>{error}</Alert>}
        <Field label="Tên khảo sát *">
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="VD: Khảo sát hài lòng sau khám" />
        </Field>
        <Field label="Loại *" hint="NPS/CSAT tự sinh câu hỏi thang điểm + góp ý.">
          <select value={type} onChange={(e) => setType(e.target.value as SurveyType)} className={selectCls}>
            <option value="nps">NPS (0–10, mức độ giới thiệu)</option>
            <option value="csat">CSAT (1–5, mức độ hài lòng)</option>
            <option value="custom">Tuỳ chỉnh (nhiều câu, thang điểm riêng)</option>
          </select>
        </Field>

        {type === 'custom' && (
          <div className="space-y-3">
            <div className="field-label text-ink-soft">Câu hỏi</div>
            {drafts.map((d, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-rule p-3">
                <div className="flex gap-2">
                  <Input value={d.text} onChange={(e) => set(i, { text: e.target.value })} placeholder={`Câu ${i + 1}`} className="flex-1" />
                  <select value={d.type} onChange={(e) => set(i, { type: e.target.value as DraftQuestion['type'] })} className={selectCls}>
                    <option value="scale">Thang điểm</option>
                    <option value="text">Văn bản</option>
                    <option value="choice">Lựa chọn</option>
                  </select>
                  {drafts.length > 1 && (
                    <button type="button" onClick={() => setDrafts((p) => p.filter((_, j) => j !== i))} className="rounded border border-rule-strong px-2 text-ink-soft hover:bg-surface-sunk" aria-label="Xoá câu">
                      ×
                    </button>
                  )}
                </div>
                {d.type === 'scale' && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Input value={d.min} onChange={(e) => set(i, { min: e.target.value })} inputMode="numeric" placeholder="Min" className="tabular" />
                    <Input value={d.max} onChange={(e) => set(i, { max: e.target.value })} inputMode="numeric" placeholder="Max" className="tabular" />
                    <Input value={d.lowLabel} onChange={(e) => set(i, { lowLabel: e.target.value })} placeholder="Nhãn thấp" />
                    <Input value={d.highLabel} onChange={(e) => set(i, { highLabel: e.target.value })} placeholder="Nhãn cao" />
                    <Input value={d.negativeAtOrBelow} onChange={(e) => set(i, { negativeAtOrBelow: e.target.value })} inputMode="numeric" placeholder="Cảnh báo nếu ≤" className="tabular" />
                    {d.id === firstScaleId && <span className="self-center text-xs text-accent">★ câu điểm chính</span>}
                  </div>
                )}
                {d.type === 'choice' && (
                  <Input value={d.optionsCsv} onChange={(e) => set(i, { optionsCsv: e.target.value })} placeholder="Phương án, cách nhau dấu phẩy" />
                )}
                <label className="flex items-center gap-2 text-xs text-ink-soft">
                  <input type="checkbox" checked={d.required} onChange={(e) => set(i, { required: e.target.checked })} />
                  Bắt buộc trả lời
                </label>
              </div>
            ))}
            <button type="button" onClick={() => setDrafts((p) => [...p, blankQuestion(p.length + 1)])} className="text-sm text-accent hover:underline">
              + Thêm câu hỏi
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-rule pt-4">
          <Button type="button" variant="ghost" onClick={() => setPreviewQs(type === 'custom' ? buildQuestions() : defaultQuestionsFor(type))}>
            Xem trước
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!name.trim() || !customValid}>
              Tạo
            </Button>
          </div>
        </div>
      </form>
      {previewQs && (
        <PreviewModal name={name || 'Khảo sát'} type={type} questions={previewQs} onClose={() => setPreviewQs(null)} />
      )}
    </DialogShell>
  );
}

// Câu hỏi mặc định để xem trước NPS/CSAT (khớp với backend defaultQuestions).
function defaultQuestionsFor(type: SurveyType): SurveyQuestion[] {
  if (type === 'nps')
    return [
      { id: 'nps', text: 'Bạn có sẵn lòng giới thiệu phòng khám cho người thân?', type: 'scale', min: 0, max: 10, lowLabel: 'Rất khó', highLabel: 'Chắc chắn giới thiệu', primary: true, required: true },
      { id: 'comment', text: 'Góp ý thêm (không bắt buộc)', type: 'text' },
    ];
  if (type === 'csat')
    return [
      { id: 'csat', text: 'Bạn hài lòng thế nào với lần khám này?', type: 'scale', min: 1, max: 5, lowLabel: 'Rất không hài lòng', highLabel: 'Rất hài lòng', primary: true, required: true },
      { id: 'comment', text: 'Góp ý thêm (không bắt buộc)', type: 'text' },
    ];
  return [];
}

function InviteDialog({ surveyId, onClose }: { surveyId: string; onClose: () => void }) {
  const [patientId, setPatientId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const patients = useQuery({ queryKey: ['patients', 1, ''], queryFn: () => fetchPatients({ page: 1, pageSize: 50 }) });

  const mutation = useMutation({
    mutationFn: () => inviteSurvey(surveyId, { patientId }),
    onSuccess: (r) => {
      toast.success(r.status === 'sent' ? 'Đã gửi lời mời khảo sát' : 'Đã tạo lời mời (gửi thất bại — kiểm tra liên hệ)');
      onClose();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  return (
    <DialogShell eyebrow="Khảo sát" title="Gửi lời mời khảo sát" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
        className="space-y-4 p-5"
      >
        {error && <Alert>{error}</Alert>}
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
        <div className="flex justify-end gap-2 border-t border-rule pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={!patientId}>
            Gửi lời mời
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
