import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  getEncounter, updateEncounter, signEncounter, amendEncounter,
  ENCOUNTER_STATUS_VI, type Encounter, type Vitals, type EncounterPatch,
} from '../lib/encounters';
import { fetchConditions } from '../lib/conditions';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Input, Alert, Skeleton } from './ui';
import { DialogShell } from './DialogShell';
import { Icd10Combobox } from './Icd10Combobox';

type Form = Pick<Encounter, 'reason' | 'history' | 'pastPersonal' | 'pastFamily' | 'examGeneral' | 'examOrgans' | 'labsSummary' | 'treatment' | 'dxPrimaryIcd10' | 'dxSecondaryIcd10' | 'treatmentFrom' | 'treatmentTo'> & { vitals: Vitals };

const ta = 'w-full rounded-md border border-rule-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint input-focus transition-[border-color,box-shadow]';

function fromEncounter(e: Encounter): Form {
  return {
    reason: e.reason, history: e.history, pastPersonal: e.pastPersonal, pastFamily: e.pastFamily,
    examGeneral: e.examGeneral, examOrgans: e.examOrgans, labsSummary: e.labsSummary, treatment: e.treatment,
    dxPrimaryIcd10: e.dxPrimaryIcd10, dxSecondaryIcd10: e.dxSecondaryIcd10, treatmentFrom: e.treatmentFrom, treatmentTo: e.treatmentTo,
    vitals: e.vitals ?? {},
  };
}

export function ExamDialog({ encounterId, onClose, onChanged }: { encounterId: string; onClose: () => void; onChanged?: () => void }) {
  const qc = useQueryClient();
  const canWrite = useAuthStore((s) => s.can)('encounter:write');
  const enc = useQuery({ queryKey: ['encounter', encounterId], queryFn: () => getEncounter(encounterId) });
  const [f, setF] = useState<Form | null>(null);
  const [amendMode, setAmendMode] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [addIcd, setAddIcd] = useState('');

  useEffect(() => { if (enc.data) setF(fromEncounter(enc.data)); }, [enc.data]);

  const patient = enc.data?.patientId;
  const conds = useQuery({ queryKey: ['conditions', patient], queryFn: () => fetchConditions(patient!), enabled: !!patient });

  const locked = enc.data?.locked ?? false;
  const editable = canWrite && (!locked || amendMode);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['encounter', encounterId] }); onChanged?.(); };

  const patchOf = (): EncounterPatch => ({ ...(f as Form) });
  const save = useMutation({ mutationFn: () => updateEncounter(encounterId, patchOf()), onSuccess: () => { toast.success('Đã lưu'); refresh(); }, onError: (e) => toast.error(getErrorMessage(e)) });
  const sign = useMutation({ mutationFn: () => signEncounter(encounterId), onSuccess: () => { toast.success('Đã ký và khoá bệnh án'); refresh(); }, onError: (e) => toast.error(getErrorMessage(e)) });
  const amend = useMutation({
    mutationFn: () => amendEncounter(encounterId, { ...patchOf(), changeReason: changeReason.trim() }),
    onSuccess: () => { toast.success('Đã lưu bản bổ sung'); setAmendMode(false); setChangeReason(''); refresh(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const set = (k: keyof Form, v: unknown) => setF((p) => (p ? { ...p, [k]: v } : p));
  const setV = (k: keyof Vitals, v: string) => setF((p) => (p ? { ...p, vitals: { ...p.vitals, [k]: v } } : p));

  const allergies = conds.data?.allergies ?? [];

  return (
    <DialogShell eyebrow={enc.data ? `Bệnh án ngoại trú · 15/BV1` : 'Bệnh án'} title={enc.data ? ENCOUNTER_STATUS_VI[enc.data.status] ?? enc.data.status : 'Đang tải…'} onClose={onClose} maxWidth="max-w-3xl">
      {enc.isLoading || !f ? (
        <div className="p-5"><Skeleton className="h-64" /></div>
      ) : enc.isError ? (
        <div className="p-5"><Alert>{getErrorMessage(enc.error)}</Alert></div>
      ) : (
        <div className="space-y-5 p-5">
          {/* Cảnh báo dị ứng đầu lượt khám (15/BV1 — must) */}
          {allergies.length > 0 && (
            <Alert>
              <span className="font-semibold">⚠ Dị ứng:</span> {allergies.map((a) => `${a.allergyName}${a.severity ? ` (${a.severity})` : ''}`).join(' · ')}
            </Alert>
          )}
          {locked && (
            <div className="flex items-center justify-between rounded-md border border-ok/35 bg-ok-wash px-3 py-2 text-sm text-ok">
              <span>Bệnh án đã ký — chỉ đọc. {enc.data?.signedAt && `(${new Date(enc.data.signedAt).toLocaleString('vi-VN')})`}</span>
              {canWrite && !amendMode && <button type="button" onClick={() => setAmendMode(true)} className="text-xs font-medium underline">Sửa bổ sung</button>}
            </div>
          )}

          <Section n="II" title="Lý do vào viện">
            <textarea className={ta} rows={2} disabled={!editable} value={f.reason ?? ''} onChange={(e) => set('reason', e.target.value)} />
          </Section>
          <Section n="III" title="Hỏi bệnh">
            <L label="1. Quá trình bệnh lý"><textarea className={ta} rows={3} disabled={!editable} value={f.history ?? ''} onChange={(e) => set('history', e.target.value)} /></L>
            <div className="grid gap-2 sm:grid-cols-2">
              <L label="2. Tiền sử bản thân"><textarea className={ta} rows={2} disabled={!editable} value={f.pastPersonal ?? ''} onChange={(e) => set('pastPersonal', e.target.value)} /></L>
              <L label="2. Tiền sử gia đình"><textarea className={ta} rows={2} disabled={!editable} value={f.pastFamily ?? ''} onChange={(e) => set('pastFamily', e.target.value)} /></L>
            </div>
          </Section>
          <Section n="IV" title="Khám bệnh">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <V label="Mạch (l/ph)" value={f.vitals.pulse} onChange={(v) => setV('pulse', v)} disabled={!editable} />
              <V label="Nhiệt độ (°C)" value={f.vitals.temp} onChange={(v) => setV('temp', v)} disabled={!editable} />
              <V label="Huyết áp" value={f.vitals.bp} onChange={(v) => setV('bp', v)} disabled={!editable} ph="120/80" />
              <V label="Nhịp thở" value={f.vitals.resp} onChange={(v) => setV('resp', v)} disabled={!editable} />
              <V label="Cân nặng (kg)" value={f.vitals.weight} onChange={(v) => setV('weight', v)} disabled={!editable} />
            </div>
            <L label="1. Toàn thân"><textarea className={ta} rows={2} disabled={!editable} value={f.examGeneral ?? ''} onChange={(e) => set('examGeneral', e.target.value)} /></L>
            <L label="2. Các bộ phận"><textarea className={ta} rows={3} disabled={!editable} value={f.examOrgans ?? ''} onChange={(e) => set('examOrgans', e.target.value)} /></L>
            <L label="3. Tóm tắt kết quả cận lâm sàng"><textarea className={ta} rows={2} disabled={!editable} value={f.labsSummary ?? ''} onChange={(e) => set('labsSummary', e.target.value)} /></L>
          </Section>
          <Section n="V" title="Chẩn đoán">
            <L label="Bệnh chính (ICD-10)">
              {editable ? <Icd10Combobox value={f.dxPrimaryIcd10 ?? ''} onChange={(c) => set('dxPrimaryIcd10', c)} /> : <div className="tabular text-sm">{f.dxPrimaryIcd10 ?? '—'}</div>}
            </L>
            <L label="Bệnh kèm theo (ICD-10)">
              <div className="flex flex-wrap gap-1.5">
                {(f.dxSecondaryIcd10 ?? []).map((c) => (
                  <span key={c} className="tabular flex items-center gap-1 rounded border border-rule px-2 py-0.5 text-xs">
                    {c}{editable && <button type="button" onClick={() => set('dxSecondaryIcd10', f.dxSecondaryIcd10.filter((x) => x !== c))} className="text-danger">×</button>}
                  </span>
                ))}
                {(f.dxSecondaryIcd10 ?? []).length === 0 && !editable && <span className="text-sm text-ink-soft">—</span>}
              </div>
              {editable && (
                <div className="mt-1.5"><Icd10Combobox value={addIcd} onChange={setAddIcd} onPick={(it) => { if (!f.dxSecondaryIcd10.includes(it.code)) set('dxSecondaryIcd10', [...f.dxSecondaryIcd10, it.code]); setAddIcd(''); }} placeholder="Thêm bệnh kèm…" /></div>
              )}
            </L>
          </Section>
          <Section n="VI" title="Điều trị / lời dặn">
            <textarea className={ta} rows={3} disabled={!editable} value={f.treatment ?? ''} onChange={(e) => set('treatment', e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <L label="Điều trị ngoại trú từ"><Input type="date" disabled={!editable} value={f.treatmentFrom ?? ''} onChange={(e) => set('treatmentFrom', e.target.value || null)} /></L>
              <L label="Đến"><Input type="date" disabled={!editable} value={f.treatmentTo ?? ''} onChange={(e) => set('treatmentTo', e.target.value || null)} /></L>
            </div>
          </Section>

          {amendMode && (
            <L label="Lý do sửa bổ sung *"><Input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="Nêu rõ lý do" /></L>
          )}

          {/* Thao tác */}
          <div className="flex flex-wrap justify-end gap-2 border-t border-rule pt-4">
            <Button variant="ghost" onClick={onClose}>Đóng</Button>
            {canWrite && !locked && (
              <>
                <Button variant="ghost" loading={save.isPending} onClick={() => save.mutate()}>Lưu</Button>
                <Button loading={sign.isPending} onClick={() => window.confirm('Ký và KHOÁ bệnh án? Sau khi ký chỉ sửa được bằng bản bổ sung.') && sign.mutate()}>Ký & khoá</Button>
              </>
            )}
            {canWrite && amendMode && (
              <Button loading={amend.isPending} disabled={changeReason.trim().length < 3} onClick={() => amend.mutate()}>Lưu bản bổ sung</Button>
            )}
          </div>
        </div>
      )}
    </DialogShell>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><span className="tabular text-accent">{n}.</span>{title}</h3>
      {children}
    </section>
  );
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="field-label">{label}</span><div className="mt-1">{children}</div></label>;
}
function V({ label, value, onChange, disabled, ph }: { label: string; value?: string; onChange: (v: string) => void; disabled: boolean; ph?: string }) {
  return <label className="block"><span className="field-label">{label}</span><Input className="tabular mt-1 h-9" disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={ph} /></label>;
}
