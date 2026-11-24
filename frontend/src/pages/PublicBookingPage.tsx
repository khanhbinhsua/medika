import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchPublicBranches, fetchSlots, submitBooking } from '../lib/booking';
import { getErrorMessage } from '../lib/api-client';
import { Button, Field, Input, Alert, Skeleton, cx } from '../components/ui';

const vnTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });

function todayVN(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function PublicBookingPage() {
  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState(todayVN());
  const [slot, setSlot] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);

  const branches = useQuery({ queryKey: ['public-branches'], queryFn: fetchPublicBranches });
  const slots = useQuery({
    queryKey: ['public-slots', branchId, date],
    queryFn: () => fetchSlots(branchId, date),
    enabled: !!branchId && !!date,
  });

  const submit = useMutation({
    mutationFn: () => submitBooking({ branchId, start: slot, fullName: fullName.trim(), phone: phone.trim(), note: note.trim() || undefined }),
    onSuccess: () => setDone(true),
  });

  const valid = branchId && slot && fullName.trim() && phone.trim().length >= 6;

  return (
    <div className="min-h-full bg-surface-sunk px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Đặt lịch hẹn</h1>
          <p className="mt-1 text-sm text-ink-soft">Chọn chi nhánh và khung giờ — phòng khám sẽ gọi xác nhận.</p>
        </div>

        {done ? (
          <div className="plate p-8 text-center">
            <div className="text-2xl">✅</div>
            <h2 className="mt-2 font-semibold text-ink">Đã gửi yêu cầu đặt lịch</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Chúng tôi sẽ liên hệ số <span className="tabular">{phone}</span> để xác nhận. Cảm ơn bạn!
            </p>
            <Button variant="ghost" className="mt-4" onClick={() => { setDone(false); setSlot(''); setFullName(''); setPhone(''); setNote(''); }}>
              Đặt lịch khác
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); if (valid) submit.mutate(); }}
            className="plate space-y-4 p-5"
          >
            {submit.isError && <Alert>{getErrorMessage(submit.error)}</Alert>}

            <Field label="Chi nhánh *">
              <select
                value={branchId}
                onChange={(e) => { setBranchId(e.target.value); setSlot(''); }}
                className="h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink"
                required
              >
                <option value="">— Chọn chi nhánh —</option>
                {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>

            <Field label="Ngày *">
              <Input type="date" min={todayVN()} value={date} onChange={(e) => { setDate(e.target.value); setSlot(''); }} required />
            </Field>

            {branchId && (
              <div>
                <div className="field-label mb-1.5">Khung giờ còn chỗ *</div>
                {slots.isLoading ? (
                  <Skeleton className="h-16" />
                ) : (slots.data ?? []).length === 0 ? (
                  <p className="rounded border border-rule bg-surface-sunk px-3 py-4 text-center text-sm text-ink-soft">
                    Không còn khung giờ trống cho ngày này — vui lòng chọn ngày khác.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                    {slots.data!.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSlot(s)}
                        className={cx(
                          'tabular rounded border px-2 py-1.5 text-sm',
                          slot === s ? 'border-accent bg-accent text-white' : 'border-rule-strong text-ink hover:bg-surface-sunk',
                        )}
                      >
                        {vnTime(s)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Họ tên *"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Nguyễn Văn A" /></Field>
              <Field label="Số điện thoại *"><Input value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" placeholder="09xxxxxxxx" /></Field>
            </div>
            <Field label="Nhu cầu / dịch vụ mong muốn"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Tư vấn trị mụn (tuỳ chọn)" /></Field>

            <Button type="submit" className="w-full" loading={submit.isPending} disabled={!valid}>
              Gửi yêu cầu đặt lịch
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
