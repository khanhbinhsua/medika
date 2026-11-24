import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  fetchPendingBookings,
  fetchBookingMatches,
  fetchDoctors,
  confirmBooking,
  rejectBooking,
} from '../lib/booking';
import type { BookingRequest } from '../lib/booking';
import { getErrorMessage } from '../lib/api-client';
import { Button, Field, Input, Alert, Badge, Skeleton } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { DialogShell } from '../components/DialogShell';

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });

export function BookingInboxPage() {
  const q = useQuery({ queryKey: ['bookings-pending'], queryFn: fetchPendingBookings, refetchInterval: 30_000 });
  const [confirming, setConfirming] = useState<BookingRequest | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Đặt lịch online" meta="Yêu cầu khách tự đặt — gọi xác nhận rồi tạo lịch hẹn" />
      {q.isLoading && <Skeleton className="h-40" />}
      {q.isError && <Alert>{getErrorMessage(q.error)}</Alert>}
      {q.data && q.data.length === 0 && (
        <div className="plate border-dashed p-10 text-center text-sm text-ink-soft">Không có yêu cầu nào đang chờ.</div>
      )}
      <div className="space-y-2">
        {q.data?.map((b) => <BookingCard key={b.id} booking={b} onConfirm={() => setConfirming(b)} />)}
      </div>
      {confirming && <ConfirmDialog booking={confirming} onClose={() => setConfirming(null)} />}
    </div>
  );
}

function BookingCard({ booking, onConfirm }: { booking: BookingRequest; onConfirm: () => void }) {
  const qc = useQueryClient();
  const reject = useMutation({
    mutationFn: () => rejectBooking(booking.id),
    onSuccess: () => { toast.success('Đã từ chối yêu cầu'); void qc.invalidateQueries({ queryKey: ['bookings-pending'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <div className="plate flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold tracking-tight">{booking.fullName}</span>
          <span className="tabular text-sm text-ink-soft">{booking.phone}</span>
          <Badge tone="neutral">{booking.branchName}</Badge>
        </div>
        <div className="tabular mt-0.5 text-sm text-ink-soft">{fmt(booking.requestedStart)}</div>
        {booking.note && <div className="mt-0.5 text-xs text-ink-soft">{booking.note}</div>}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => reject.mutate()} loading={reject.isPending}>Từ chối</Button>
        <Button className="h-8 px-3 text-xs" onClick={onConfirm}>Xác nhận</Button>
      </div>
    </div>
  );
}

function ConfirmDialog({ booking, onClose }: { booking: BookingRequest; onClose: () => void }) {
  const qc = useQueryClient();
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: fetchDoctors });
  const matches = useQuery({ queryKey: ['booking-matches', booking.id], queryFn: () => fetchBookingMatches(booking.id) });

  const [doctorId, setDoctorId] = useState('');
  const [mode, setMode] = useState<'existing' | 'new'>('new');
  const [patientId, setPatientId] = useState('');
  // Tách họ tên: từ cuối là "tên", phần đầu là "họ" (đơn giản, lễ tân chỉnh được).
  const parts = booking.fullName.trim().split(/\s+/);
  const [lastName, setLastName] = useState(parts.slice(0, -1).join(' ') || booking.fullName);
  const [firstName, setFirstName] = useState(parts.length > 1 ? parts[parts.length - 1]! : '');
  const [dob, setDob] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Khi có gợi ý khớp SĐT → mặc định chọn liên kết (một lần, khi matches về).
  const hasMatches = (matches.data ?? []).length > 0;
  useEffect(() => {
    if (hasMatches && !patientId) {
      setMode('existing');
      setPatientId(matches.data![0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches.data]);

  const mutation = useMutation({
    mutationFn: () =>
      confirmBooking(booking.id, {
        doctorId,
        ...(mode === 'existing'
          ? { patientId }
          : { newPatient: { firstName: firstName.trim(), lastName: lastName.trim(), dob, gender: 'unknown' } }),
      }),
    onSuccess: () => {
      toast.success('Đã xác nhận — đã tạo lịch hẹn');
      void qc.invalidateQueries({ queryKey: ['bookings-pending'] });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const valid = doctorId && (mode === 'existing' ? !!patientId : firstName.trim() && lastName.trim() && dob);

  return (
    <DialogShell eyebrow="Xác nhận đặt lịch" title={`${booking.fullName} · ${fmt(booking.requestedStart)}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); if (valid) mutation.mutate(); }} className="space-y-4 p-5">
        {error && <Alert>{error}</Alert>}

        <Field label="Bác sĩ phụ trách *">
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} required className="h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink">
            <option value="">— Chọn bác sĩ —</option>
            {doctors.data?.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </select>
        </Field>

        <div className="rounded-lg border border-rule p-3">
          <div className="mb-2 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} disabled={!hasMatches} /> Bệnh nhân có sẵn</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> Tạo hồ sơ mới</label>
          </div>

          {mode === 'existing' ? (
            matches.isLoading ? (
              <Skeleton className="h-10" />
            ) : hasMatches ? (
              <select value={patientId} onChange={(e) => setPatientId(e.target.value)} className="h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink">
                {matches.data!.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.mrn}</option>)}
              </select>
            ) : (
              <p className="text-sm text-ink-soft">Không tìm thấy bệnh nhân khớp số điện thoại.</p>
            )
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Họ *"><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
                <Field label="Tên *"><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
              </div>
              <Field label="Ngày sinh *" hint="Hỏi khách khi gọi xác nhận"><Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></Field>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-rule pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!valid}>Xác nhận & tạo lịch</Button>
        </div>
      </form>
    </DialogShell>
  );
}
