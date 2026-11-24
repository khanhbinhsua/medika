import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { purgePatient } from '../lib/patients';
import type { DeletedPatient } from '../lib/patients';
import { getErrorMessage } from '../lib/api-client';
import { Button, Input, Field, Alert } from './ui';
import { DialogShell } from './DialogShell';

export function PurgePatientDialog({
  patient,
  onClose,
  onPurged,
}: {
  patient: DeletedPatient;
  onClose: () => void;
  onPurged: () => void;
}) {
  const [reason, setReason] = useState('');
  const [confirmMrn, setConfirmMrn] = useState('');

  const mutation = useMutation({
    mutationFn: () => purgePatient(patient.id, reason.trim()),
    onSuccess: () => {
      toast.success('Đã tiêu huỷ vĩnh viễn');
      onPurged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const mrnMatches = confirmMrn.trim() === patient.mrn;
  const ready = reason.trim().length >= 10 && mrnMatches;

  return (
    <DialogShell eyebrow="Tiêu huỷ vĩnh viễn" title={patient.displayName} onClose={onClose} maxWidth="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) mutation.mutate();
        }}
        className="space-y-4 p-5"
      >
        <Alert tone="danger">
          <span className="font-semibold">Hành động này không thể hoàn tác.</span> Khoá mã hoá của bệnh nhân sẽ
          bị huỷ vĩnh viễn — hồ sơ nhân khẩu học, lý do khám mọi lịch hẹn, nội dung mọi hồ sơ bệnh án, hướng dẫn
          mọi đơn thuốc sẽ vĩnh viễn không thể đọc lại được, kể cả trong bản sao lưu cũ.
        </Alert>

        <Field label="Lý do tiêu huỷ *" hint="Tối thiểu 10 ký tự — được lưu vĩnh viễn cùng bản ghi và nhật ký kiểm toán.">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            required
            className="w-full rounded border border-rule-strong bg-surface p-3 text-sm leading-relaxed text-ink"
          />
        </Field>

        <Field label={`Gõ lại mã hồ sơ "${patient.mrn}" để xác nhận *`}>
          <Input
            value={confirmMrn}
            onChange={(e) => setConfirmMrn(e.target.value)}
            placeholder={patient.mrn}
            required
            className="tabular"
            invalid={confirmMrn.length > 0 && !mrnMatches}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ bỏ
          </Button>
          <Button type="submit" variant="danger" loading={mutation.isPending} disabled={!ready}>
            Tiêu huỷ vĩnh viễn
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
