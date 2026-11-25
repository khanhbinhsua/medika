import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiClient, getErrorMessage } from '../lib/api-client';
import { fetchPatients, fullName } from '../lib/patients';
import { createAppointment } from '../lib/clinical';
import { fetchPatientPackages } from '../lib/billing';
import { Button, Input, Field, Alert } from './ui';

interface Doctor {
  id: string;
  fullName: string;
}

async function fetchDoctors() {
  const { data } = await apiClient.get<Doctor[]>('/users/doctors');
  return data;
}

/** Gộp ngày + giờ ở múi giờ máy người dùng thành ISO kèm offset. */
function toIso(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

export function NewAppointmentDialog({
  presetPatientId,
  onClose,
  onCreated,
}: {
  presetPatientId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [patientId, setPatientId] = useState(presetPatientId ?? '');
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('09:00');
  const [durationMin, setDurationMin] = useState(30);
  const [room, setRoom] = useState('');
  const [reason, setReason] = useState('');
  const [customerPackageId, setCustomerPackageId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: fetchDoctors });
  const packages = useQuery({
    queryKey: ['patient-packages', patientId],
    queryFn: () => fetchPatientPackages(patientId),
    enabled: !!patientId,
  });
  const usablePackages = (packages.data ?? []).filter((p) => p.remaining > 0);
  const patients = useQuery({
    queryKey: ['patients', 1, ''],
    queryFn: () => fetchPatients({ page: 1, pageSize: 50 }),
    enabled: !presetPatientId,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: () => {
      const start = toIso(date, startTime);
      const end = new Date(new Date(start).getTime() + durationMin * 60_000).toISOString();
      return createAppointment({
        patientId,
        doctorId,
        scheduledStart: start,
        scheduledEnd: end,
        ...(room.trim() ? { room: room.trim() } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(customerPackageId ? { customerPackageId } : {}),
      });
    },
    onSuccess: () => {
      toast.success('Đã đặt lịch hẹn');
      onCreated();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-appt-title"
        className="plate rise my-auto w-full max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-3.5">
          <div>
            <div className="tabular field-label text-accent">Lịch hẹn mới</div>
            <h2 id="new-appt-title" className="text-base font-semibold tracking-tight">
              Đặt lịch khám
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded border border-rule-strong px-2 py-1 text-xs text-ink-soft hover:bg-surface-sunk"
          >
            Esc
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <Alert>{error}</Alert>}

          {!presetPatientId && (
            <Field
              label="Bệnh nhân *"
              hint={
                patients.data && patients.data.pagination.total > 50
                  ? 'Đang hiển thị 50 hồ sơ gần nhất — mở từ trang bệnh nhân để chọn chính xác.'
                  : undefined
              }
            >
              <select
                value={patientId}
                onChange={(e) => { setPatientId(e.target.value); setCustomerPackageId(''); }}
                required
                className="h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink"
              >
                <option value="">— Chọn bệnh nhân —</option>
                {patients.data?.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {fullName(p)} · {p.mrn}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Bác sĩ *">
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              required
              className="h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink"
            >
              <option value="">— Chọn bác sĩ —</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Ngày khám *">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="tabular" />
            </Field>
            <Field label="Giờ bắt đầu *">
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="tabular"
              />
            </Field>
            <Field label="Thời lượng">
              <select
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                className="h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink"
              >
                {[15, 30, 45, 60, 90].map((m) => (
                  <option key={m} value={m}>
                    {m} phút
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Field label="Phòng">
              <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="P.204" className="tabular" />
            </Field>
            <Field label="Lý do khám" hint="Được lưu mã hoá — đây là thông tin sức khoẻ.">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </Field>
          </div>

          {usablePackages.length > 0 && (
            <Field label="Trừ vào gói (buổi còn lại)" hint="Khi lịch hẹn hoàn tất sẽ tự trừ 1 buổi của gói đã chọn.">
              <select
                value={customerPackageId}
                onChange={(e) => setCustomerPackageId(e.target.value)}
                className="h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink"
              >
                <option value="">— Không dùng gói —</option>
                {usablePackages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · còn {p.remaining}/{p.total}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!patientId || !doctorId}>
              Đặt lịch
            </Button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}
