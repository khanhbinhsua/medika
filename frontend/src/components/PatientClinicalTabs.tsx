import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPrescriptions,
  fetchAppointments,
  PRESCRIPTION_STATUS_LABELS,
  APPOINTMENT_STATUS_LABELS,
  formatDateTime,
  formatTimeRange,
  statusTone,
} from '../lib/clinical';
import { fetchPatient, fullName } from '../lib/patients';
import { printPrescriptions } from '../lib/print';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Alert, Badge, Skeleton, cx } from './ui';
import { NewPrescriptionDialog } from './NewPrescriptionDialog';
import { DocumentsTab } from './DocumentsTab';
import { PhotosTab } from './PhotosTab';
import { SpendingTab } from './SpendingTab';
import { ConditionsTab } from './ConditionsTab';
import { BillingTab } from './BillingTab';
import { BenhAnTab } from './BenhAnTab';

type Tab = 'encounter' | 'conditions' | 'prescriptions' | 'photos' | 'appointments' | 'documents' | 'spending' | 'billing';

export function PatientClinicalTabs({ patientId }: { patientId: string }) {
  const can = useAuthStore((s) => s.can);

  const tabs: Array<{ id: Tab; label: string; visible: boolean }> = [
    { id: 'encounter', label: 'Bệnh án', visible: can('encounter:read') },
    { id: 'conditions', label: 'Bệnh lý & Dị ứng', visible: can('condition:read') },
    { id: 'prescriptions', label: 'Đơn thuốc', visible: can('record:read') },
    { id: 'photos', label: 'Ảnh trước/sau', visible: can('photo:read') },
    { id: 'documents', label: 'Tài liệu', visible: can('document:read') },
    { id: 'appointments', label: 'Lịch hẹn', visible: can('appointment:read') },
    { id: 'spending', label: 'Chi tiêu', visible: can('spending:read') },
    { id: 'billing', label: 'Thanh toán', visible: can('billing:read') },
  ];

  const visible = tabs.filter((t) => t.visible);
  const [tab, setTab] = useState<Tab>(visible[0]?.id ?? 'appointments');

  if (visible.length === 0) return null;

  return (
    <section className="plate">
      <div className="flex border-b border-rule bg-surface-sunk" role="tablist">
        {visible.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              'relative px-4 py-2.5 text-xs font-medium transition-colors duration-150',
              tab === t.id ? 'text-ink' : 'text-ink-soft hover:text-ink',
            )}
          >
            {t.label}
            <span
              className={cx(
                'absolute inset-x-0 -bottom-px h-0.5 transition-opacity duration-150',
                tab === t.id ? 'bg-accent opacity-100' : 'opacity-0',
              )}
            />
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === 'encounter' && <BenhAnTab patientId={patientId} />}
        {tab === 'conditions' && <ConditionsTab patientId={patientId} />}
        {tab === 'prescriptions' && <PrescriptionsTab patientId={patientId} />}
        {tab === 'photos' && <PhotosTab patientId={patientId} />}
        {tab === 'documents' && <DocumentsTab patientId={patientId} />}
        {tab === 'appointments' && <AppointmentsTab patientId={patientId} />}
        {tab === 'spending' && <SpendingTab patientId={patientId} />}
        {tab === 'billing' && <BillingTab patientId={patientId} />}
      </div>
    </section>
  );
}

// ── Đơn thuốc ─────────────────────────────────────────────────────────

function PrescriptionsTab({ patientId }: { patientId: string }) {
  const can = useAuthStore((s) => s.can);
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['prescriptions', patientId],
    queryFn: () => fetchPrescriptions(patientId),
  });
  const patient = useQuery({ queryKey: ['patient', patientId], queryFn: () => fetchPatient(patientId) });

  if (isError) return <Alert>{getErrorMessage(error)}</Alert>;

  const onPrint = () => {
    if (!data || !patient.data) return;
    printPrescriptions({ patientName: fullName(patient.data), mrn: patient.data.mrn, items: data });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        {data && data.length > 0 && (
          <Button variant="ghost" className="h-8 px-3 text-xs" disabled={!patient.data} onClick={onPrint}>
            In đơn
          </Button>
        )}
        {can('prescription:write') && (
          <Button className="h-8 px-3 text-xs" onClick={() => setCreating(true)}>
            Kê đơn
          </Button>
        )}
      </div>

      {isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : data && data.length > 0 ? (
        <ul className="space-y-2">
          {data.map((p) => (
            <li key={p.id} className="plate p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{p.medication}</span>
                <Badge tone={p.status === 'active' ? 'ok' : 'neutral'}>
                  {PRESCRIPTION_STATUS_LABELS[p.status]}
                </Badge>
              </div>
              <div className="tabular mt-1 text-xs text-ink-soft">
                {p.dosage} · {p.frequency}
                {p.durationDays ? ` · ${p.durationDays} ngày` : ''}
              </div>
              {p.instructions && <p className="mt-1.5 text-xs text-ink-soft">{p.instructions}</p>}
              <div className="mt-1.5 text-[11px] text-ink-faint">
                <span className="tabular">{formatDateTime(p.prescribedAt)}</span> · {p.prescriberName}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-sm text-ink-soft">Chưa có đơn thuốc nào.</p>
      )}

      {creating && (
        <NewPrescriptionDialog
          patientId={patientId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['prescriptions', patientId] });
          }}
        />
      )}
    </div>
  );
}

// ── Lịch hẹn ──────────────────────────────────────────────────────────

function AppointmentsTab({ patientId }: { patientId: string }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['appointments', { patientId }],
    queryFn: () => fetchAppointments({ patientId, pageSize: 50 }),
  });

  if (isError) return <Alert>{getErrorMessage(error)}</Alert>;
  if (isPending) return <Skeleton className="h-20 w-full" />;
  if (!data || data.data.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-soft">Chưa có lịch hẹn nào.</p>;
  }

  return (
    <ul className="space-y-2">
      {data.data.map((a) => (
        <li key={a.id} className="plate flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="min-w-0">
            <div className="tabular text-sm text-ink">
              {new Date(a.scheduledStart).toLocaleDateString('vi-VN')} ·{' '}
              {formatTimeRange(a.scheduledStart, a.scheduledEnd)}
            </div>
            <div className="mt-0.5 text-xs text-ink-soft">
              {a.doctorName}
              {a.room ? ` · ${a.room}` : ''}
            </div>
            {a.reason && <p className="mt-1 text-xs text-ink-soft">{a.reason}</p>}
          </div>
          <Badge tone={statusTone(a.status)}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
        </li>
      ))}
    </ul>
  );
}
