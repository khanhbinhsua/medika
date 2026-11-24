import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { createPrescription } from '../lib/clinical';
import { getErrorMessage } from '../lib/api-client';
import { Button, Input, Field, Alert } from './ui';
import { DialogShell } from './DialogShell';

export function NewPrescriptionDialog({
  patientId,
  encounterId,
  onClose,
  onCreated,
}: {
  patientId: string;
  encounterId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [medication, setMedication] = useState('');
  const [dosage, setDosage] = useState('');
  const [frequency, setFrequency] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [quantity, setQuantity] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: () =>
      createPrescription({
        patientId,
        ...(encounterId ? { encounterId } : {}),
        medication: medication.trim(),
        dosage: dosage.trim(),
        frequency: frequency.trim(),
        ...(durationDays ? { durationDays: Number(durationDays) } : {}),
        ...(quantity.trim() ? { quantity: quantity.trim() } : {}),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success('Đã kê đơn thuốc');
      onCreated();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const ready = medication.trim() && dosage.trim() && frequency.trim();

  return (
    <DialogShell eyebrow="Đơn thuốc mới" title="Kê đơn" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
        className="space-y-4 p-5"
      >
        {error && <Alert>{error}</Alert>}

        <Field label="Tên thuốc *">
          <Input value={medication} onChange={(e) => setMedication(e.target.value)} required autoFocus maxLength={200} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Liều dùng *">
            <Input value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="500mg" required />
          </Field>
          <Field label="Tần suất *">
            <Input
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              placeholder="2 lần/ngày sau ăn"
              required
            />
          </Field>
          <Field label="Số ngày dùng" hint="Dùng để tính hạn của đơn.">
            <Input
              type="number"
              min={1}
              max={365}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              className="tabular"
            />
          </Field>
          <Field label="Số lượng">
            <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="30 viên" />
          </Field>
        </div>

        <Field label="Hướng dẫn thêm" hint="Được lưu mã hoá cùng hồ sơ bệnh nhân.">
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full rounded border border-rule-strong bg-surface p-3 text-sm leading-relaxed text-ink"
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={!ready}>
            Kê đơn
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
