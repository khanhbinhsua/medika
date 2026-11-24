import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  fetchConsents,
  recordConsent,
  revokeConsent,
  CONSENT_LABELS,
} from '../lib/compliance';
import type { Consent, ConsentType } from '../lib/compliance';
import { formatDateTime } from '../lib/clinical';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Alert, Badge, Skeleton, Input, Field } from './ui';
import { DialogShell } from './DialogShell';

const ALL_TYPES = Object.keys(CONSENT_LABELS) as ConsentType[];

export function PatientConsents({ patientId }: { patientId: string }) {
  const can = useAuthStore((s) => s.can);
  const queryClient = useQueryClient();
  const [recording, setRecording] = useState<ConsentType | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['consents', patientId],
    queryFn: () => fetchConsents(patientId),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['consents', patientId] });

  const revoke = useMutation({
    mutationFn: revokeConsent,
    onSuccess: () => {
      toast.success('Đã thu hồi');
      invalidate();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const active = new Map<ConsentType, Consent>();
  for (const c of data ?? []) {
    if (!c.revokedAt) active.set(c.consentType, c);
  }
  const history = (data ?? []).filter((c) => c.revokedAt);

  return (
    <section className="plate">
      <div className="flex items-center justify-between border-b border-rule bg-surface-sunk px-4 py-2">
        <h2 className="field-label">Đồng ý của bệnh nhân</h2>
        {history.length > 0 && (
          <button onClick={() => setShowHistory((v) => !v)} className="text-xs text-accent hover:underline">
            {showHistory ? 'Ẩn lịch sử' : `Lịch sử (${history.length})`}
          </button>
        )}
      </div>

      <div className="p-4">
        {isError && <Alert>{getErrorMessage(error)}</Alert>}

        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <ul className="space-y-2">
            {ALL_TYPES.map((type) => {
              const consent = active.get(type);
              return (
                <li
                  key={type}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-ink">{CONSENT_LABELS[type]}</span>
                      {consent ? (
                        <Badge tone={consent.granted ? 'ok' : 'danger'}>
                          {consent.granted ? 'Đã đồng ý' : 'Đã từ chối'}
                        </Badge>
                      ) : (
                        <Badge tone="warn">Chưa ghi nhận</Badge>
                      )}
                    </div>
                    {consent && (
                      <div className="mt-0.5 text-xs text-ink-faint">
                        <span className="tabular">{formatDateTime(consent.grantedAt)}</span> · bản{' '}
                        {consent.documentVersion}
                        {consent.witnessedByName ? ` · chứng kiến: ${consent.witnessedByName}` : ''}
                      </div>
                    )}
                  </div>

                  {can('patient:write') && (
                    <div className="flex shrink-0 gap-2">
                      <Button variant="ghost" className="h-7 px-2.5 text-xs" onClick={() => setRecording(type)}>
                        {consent ? 'Cập nhật' : 'Ghi nhận'}
                      </Button>
                      {consent && (
                        <Button
                          variant="danger"
                          className="h-7 px-2.5 text-xs"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(consent.id)}
                        >
                          Thu hồi
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {showHistory && history.length > 0 && (
          <div className="rule-t mt-4 pt-3">
            <h3 className="field-label">Lịch sử đã thu hồi</h3>
            <p className="mt-1 text-xs text-ink-faint">
              Bản ghi cũ không bị xoá — cần giữ để chứng minh tại thời điểm điều trị đã có đồng ý hợp lệ.
            </p>
            <ul className="mt-2 space-y-1.5">
              {history.map((c) => (
                <li key={c.id} className="border-l-2 border-rule pl-3 text-xs text-ink-soft">
                  <span className="text-ink">{CONSENT_LABELS[c.consentType]}</span> ·{' '}
                  {c.granted ? 'đồng ý' : 'từ chối'} · bản {c.documentVersion}
                  <div className="tabular mt-0.5 text-ink-faint">
                    {formatDateTime(c.grantedAt)} → thu hồi {formatDateTime(c.revokedAt!)}
                  </div>
                  {c.notes && <div className="mt-0.5 text-ink-faint">{c.notes}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {recording && (
        <RecordConsentDialog
          patientId={patientId}
          consentType={recording}
          onClose={() => setRecording(null)}
          onSaved={() => {
            setRecording(null);
            invalidate();
          }}
        />
      )}
    </section>
  );
}

function RecordConsentDialog({
  patientId,
  consentType,
  onClose,
  onSaved,
}: {
  patientId: string;
  consentType: ConsentType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [granted, setGranted] = useState(true);
  const [documentVersion, setDocumentVersion] = useState('v1.0');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      recordConsent({
        patientId,
        consentType,
        granted,
        documentVersion: documentVersion.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success('Đã ghi nhận');
      onSaved();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  return (
    <DialogShell eyebrow="Ghi nhận đồng ý" title={CONSENT_LABELS[consentType]} onClose={onClose} maxWidth="max-w-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
        className="space-y-4 p-5"
      >
        {error && <Alert>{error}</Alert>}

        <div>
          <span className="field-label">Quyết định của bệnh nhân</span>
          <div className="mt-1.5 flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className={granted ? 'flex-1 border-ok text-ok' : 'flex-1'}
              onClick={() => setGranted(true)}
            >
              Đồng ý
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={!granted ? 'flex-1 border-danger text-danger' : 'flex-1'}
              onClick={() => setGranted(false)}
            >
              Từ chối
            </Button>
          </div>
        </div>

        <Field label="Phiên bản văn bản *" hint="Ghi đúng bản mà bệnh nhân đã đọc và ký.">
          <Input
            value={documentVersion}
            onChange={(e) => setDocumentVersion(e.target.value)}
            required
            className="tabular"
            maxLength={50}
          />
        </Field>

        <Field label="Ghi chú">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>

        <p className="text-xs text-ink-faint">
          Quyết định trước đó (nếu có) sẽ được đánh dấu thu hồi nhưng vẫn giữ trong lịch sử.
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={!documentVersion.trim()}>
            Lưu
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
