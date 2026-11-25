import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createPatient } from '../lib/patients';
import { getErrorMessage } from '../lib/api-client';
import { Button, Input, Field, Alert } from './ui';

interface Form {
  firstName: string;
  lastName: string;
  dob: string;
  gender: string;
  email: string;
  phone: string;
  address: string;
  insuranceId: string;
}

const EMPTY: Form = {
  firstName: '',
  lastName: '',
  dob: '',
  gender: '',
  email: '',
  phone: '',
  address: '',
  insuranceId: '',
};

export function NewPatientDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Khoá cuộn nền để tiêu điểm nằm trong hộp thoại
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Trường rỗng phải bỏ hẳn, không gửi chuỗi rỗng — backend validate optional.
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v !== ''),
      );
      await createPatient(payload);
      onCreated();
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 backdrop-blur-[2px] sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-patient-title"
        className="plate rise w-full max-w-2xl"
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-3.5">
          <div>
            <div className="tabular field-label text-accent">Hồ sơ mới</div>
            <h2 id="new-patient-title" className="text-base font-semibold tracking-tight">
              Thêm bệnh nhân
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="rounded border border-rule-strong px-2 py-1 text-xs text-ink-soft hover:bg-surface-sunk"
          >
            Esc
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-5">
          {error && <Alert>{error}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Họ và tên đệm *">
              <Input ref={firstFieldRef} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} required />
            </Field>
            <Field label="Tên *">
              <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required />
            </Field>
            <Field label="Ngày sinh *">
              <Input type="date" value={form.dob} onChange={(e) => set('dob', e.target.value)} required className="tabular" />
            </Field>
            <Field label="Giới tính">
              <select
                value={form.gender}
                onChange={(e) => set('gender', e.target.value)}
                className="h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink"
              >
                <option value="">— Chọn —</option>
                <option value="male">Nam</option>
                <option value="female">Nữ</option>
                <option value="other">Khác</option>
                <option value="unknown">Không rõ</option>
              </select>
            </Field>
            <Field label="Số điện thoại">
              <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} className="tabular" />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Mã bảo hiểm y tế">
              <Input value={form.insuranceId} onChange={(e) => set('insuranceId', e.target.value)} className="tabular" />
            </Field>
            <Field label="Địa chỉ">
              <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
          </div>

          <p className="rule-t pt-3 text-xs text-ink-faint">
            Mã hồ sơ (MRN) được hệ thống sinh tự động. Toàn bộ trường định danh sẽ được mã hoá trước khi lưu.
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" loading={busy}>
              Tạo hồ sơ
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
