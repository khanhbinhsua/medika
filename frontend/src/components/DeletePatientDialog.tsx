import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { deletePatient, fullName } from '../lib/patients';
import type { Patient } from '../lib/patients';
import { getErrorMessage } from '../lib/api-client';
import { Button, Alert } from './ui';
import { DialogShell } from './DialogShell';

export function DeletePatientDialog({
  patient,
  onClose,
  onDeleted,
}: {
  patient: Patient;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const mutation = useMutation({
    mutationFn: () => deletePatient(patient.id),
    onSuccess: () => {
      toast.success('Đã xoá hồ sơ');
      onDeleted();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <DialogShell eyebrow="Xoá hồ sơ" title={fullName(patient)} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4 p-5">
        {mutation.isError && <Alert>{getErrorMessage(mutation.error)}</Alert>}

        <p className="text-sm leading-relaxed text-ink-soft">
          Hồ sơ sẽ ẩn khỏi danh sách bệnh nhân và mọi tìm kiếm. <span className="text-ink">Dữ liệu vẫn được
          giữ nguyên</span> — đây chưa phải tiêu huỷ vĩnh viễn.
        </p>
        <p className="text-xs text-ink-faint">
          Tiêu huỷ vĩnh viễn (không thể hoàn tác) là một bước riêng, chỉ quản trị viên thực hiện được, sau một
          thời gian ân hạn kể từ lúc xoá — xem mục "Đã xoá" trong trang bệnh nhân.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button variant="danger" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Xoá hồ sơ
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
