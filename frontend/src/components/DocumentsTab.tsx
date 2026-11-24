import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  fetchDocuments,
  uploadDocument,
  downloadDocument,
  deleteDocument,
  formatFileSize,
  formatDateTime,
} from '../lib/clinical';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Alert, Skeleton } from './ui';

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.tiff';

export function DocumentsTab({ patientId }: { patientId: string }) {
  const can = useAuthStore((s) => s.can);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['documents', patientId],
    queryFn: () => fetchDocuments(patientId),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['documents', patientId] });

  const upload = useMutation({
    mutationFn: (file: File) => uploadDocument(patientId, file),
    onSuccess: () => {
      toast.success('Đã tải lên tài liệu');
      invalidate();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => {
      toast.success('Đã xoá tài liệu');
      invalidate();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  async function handleDownload(id: string, fileName: string) {
    setDownloadingId(id);
    try {
      await downloadDocument(id, fileName);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDownloadingId(null);
    }
  }

  if (isError) return <Alert>{getErrorMessage(error)}</Alert>;

  return (
    <div className="space-y-3">
      {can('document:write') && (
        <div className="flex items-center justify-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = '';
            }}
          />
          <Button className="h-8 px-3 text-xs" loading={upload.isPending} onClick={() => fileInputRef.current?.click()}>
            Tải lên tài liệu
          </Button>
        </div>
      )}

      <p className="text-xs text-ink-faint">
        Chấp nhận PDF, JPG, PNG, TIFF. Nội dung file được mã hoá trước khi lưu; mỗi lượt tải xuống đều được ghi
        vào nhật ký truy cập.
      </p>

      {isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : data && data.length > 0 ? (
        <ul className="space-y-2">
          {data.map((doc) => (
            <li key={doc.id} className="plate flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <button
                  onClick={() => handleDownload(doc.id, doc.fileName)}
                  disabled={downloadingId === doc.id}
                  className="truncate text-left text-sm text-accent hover:underline disabled:opacity-50"
                >
                  {doc.fileName}
                </button>
                <div className="tabular mt-0.5 text-[11px] text-ink-faint">
                  {formatFileSize(doc.sizeBytes)} · {formatDateTime(doc.createdAt)}
                  {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ''}
                </div>
              </div>

              {can('document:write') && (
                <Button
                  variant="danger"
                  className="h-7 px-2.5 text-xs"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(doc.id)}
                >
                  Xoá
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-sm text-ink-soft">Chưa có tài liệu nào.</p>
      )}
    </div>
  );
}
