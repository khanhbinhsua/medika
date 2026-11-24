import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  fetchPhotos,
  uploadPhoto,
  deletePhoto,
  fetchPhotoObjectUrl,
  PHOTO_CATEGORY_LABELS,
  type ClinicalPhoto,
  type PhotoCategory,
} from '../lib/photos';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Input, Field, Alert, Badge, Skeleton } from './ui';
import { DialogShell } from './DialogShell';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const CATS: PhotoCategory[] = ['before', 'after', 'progress'];

function catTone(c: PhotoCategory): 'neutral' | 'accent' | 'ok' {
  return c === 'before' ? 'neutral' : c === 'after' ? 'ok' : 'accent';
}

export function PhotosTab({ patientId, encounterId }: { patientId: string; encounterId?: string }) {
  const can = useAuthStore((s) => s.can);
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<ClinicalPhoto | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['photos', patientId, encounterId ?? null],
    queryFn: () => fetchPhotos(patientId, encounterId),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['photos', patientId] });

  const remove = useMutation({
    mutationFn: deletePhoto,
    onSuccess: () => { toast.success('Đã xoá ảnh'); invalidate(); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (isError) return <Alert>{getErrorMessage(error)}</Alert>;

  // Gom nhóm theo vùng cơ thể (giữ nguyên thứ tự server trả về).
  const groups = new Map<string, ClinicalPhoto[]>();
  for (const p of data ?? []) {
    const key = p.bodyArea?.trim() || 'Chưa phân vùng';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-faint">Ảnh được mã hoá trước khi lưu; mỗi lượt xem đều ghi nhật ký truy cập.</p>
        {can('photo:write') && (
          <Button className="h-8 px-3 text-xs" onClick={() => setUploading(true)}>+ Thêm ảnh</Button>
        )}
      </div>

      {isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      ) : (data ?? []).length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-soft">Chưa có ảnh trước/sau nào.</p>
      ) : (
        <div className="space-y-5">
          {[...groups.entries()].map(([area, photos]) => (
            <section key={area} className="space-y-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
                {area}<span className="text-xs font-normal text-ink-faint">({photos.length})</span>
              </h4>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {photos.map((p) => (
                  <figure key={p.id} className="plate group relative overflow-hidden p-0">
                    <button type="button" onClick={() => setLightbox(p)} className="block w-full">
                      <PhotoImg id={p.id} className="aspect-square w-full object-cover" alt={p.caption ?? area} />
                    </button>
                    <div className="absolute left-1.5 top-1.5">
                      <Badge tone={catTone(p.category)}>{PHOTO_CATEGORY_LABELS[p.category]}</Badge>
                    </div>
                    <figcaption className="space-y-0.5 px-2 py-1.5">
                      <div className="tabular text-[11px] text-ink-soft">{p.takenAt}</div>
                      {p.caption && <div className="truncate text-xs text-ink" title={p.caption}>{p.caption}</div>}
                    </figcaption>
                    {can('photo:write') && (
                      <button
                        type="button"
                        onClick={() => window.confirm('Xoá ảnh này?') && remove.mutate(p.id)}
                        className="absolute right-1.5 top-1.5 rounded bg-surface/80 px-1.5 py-0.5 text-[11px] text-danger opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        Xoá
                      </button>
                    )}
                  </figure>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {uploading && (
        <UploadPhotoDialog
          patientId={patientId}
          encounterId={encounterId}
          onClose={() => setUploading(false)}
          onCreated={() => { setUploading(false); invalidate(); }}
        />
      )}
      {lightbox && <Lightbox photo={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ── Ảnh (tải blob có auth → object URL, revoke khi unmount) ─────────────

function PhotoImg({ id, className, alt }: { id: string; className?: string; alt?: string }) {
  const { data: url, isError } = useQuery({
    queryKey: ['photo-img', id],
    queryFn: () => fetchPhotoObjectUrl(id),
    staleTime: Infinity,
    gcTime: 0,
  });

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (isError) return <div className={`flex items-center justify-center bg-surface-sunk text-xs text-ink-faint ${className ?? ''}`}>Lỗi tải ảnh</div>;
  if (!url) return <div className={`shimmer bg-surface-sunk ${className ?? ''}`} />;
  return <img src={url} alt={alt ?? ''} className={className} />;
}

function Lightbox({ photo, onClose }: { photo: ClinicalPhoto; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      <div className="max-h-full max-w-3xl overflow-hidden rounded-lg bg-surface" onClick={(e) => e.stopPropagation()}>
        <PhotoImg id={photo.id} className="max-h-[70vh] w-full object-contain" alt={photo.caption ?? ''} />
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <div>
            <span className="font-medium text-ink">{photo.bodyArea ?? 'Chưa phân vùng'}</span>
            <span className="ml-2 text-ink-soft">{PHOTO_CATEGORY_LABELS[photo.category]} · {photo.takenAt}</span>
            {photo.caption && <p className="mt-0.5 text-xs text-ink-soft">{photo.caption}</p>}
          </div>
          <Button variant="ghost" className="h-7 px-3 text-xs" onClick={onClose}>Đóng</Button>
        </div>
      </div>
    </div>
  );
}

// ── Dialog tải ảnh ──────────────────────────────────────────────────────

function UploadPhotoDialog({
  patientId, encounterId, onClose, onCreated,
}: { patientId: string; encounterId?: string; onClose: () => void; onCreated: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [category, setCategory] = useState<PhotoCategory>('before');
  const [bodyArea, setBodyArea] = useState('');
  const [caption, setCaption] = useState('');
  const [takenAt, setTakenAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
  }

  const mutation = useMutation({
    mutationFn: () =>
      uploadPhoto({
        patientId, category, file: file!,
        ...(bodyArea.trim() ? { bodyArea: bodyArea.trim() } : {}),
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        ...(takenAt ? { takenAt } : {}),
        ...(encounterId ? { encounterId } : {}),
      }),
    onSuccess: () => { toast.success('Đã thêm ảnh'); onCreated(); },
    onError: (err) => setError(getErrorMessage(err)),
  });

  return (
    <DialogShell eyebrow="Ảnh trước/sau" title="Thêm ảnh" onClose={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); setError(null); if (!file) { setError('Vui lòng chọn ảnh'); return; } mutation.mutate(); }}
        className="space-y-4 p-5"
      >
        {error && <Alert>{error}</Alert>}

        <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-40 w-full items-center justify-center overflow-hidden rounded-md border border-dashed border-rule-strong bg-surface-sunk text-sm text-ink-soft hover:border-accent"
        >
          {preview ? <img src={preview} alt="Xem trước" className="h-full w-full object-contain" /> : 'Bấm để chọn ảnh (JPG/PNG/WebP)'}
        </button>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Loại ảnh *">
            <div className="flex gap-1.5">
              {CATS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${category === c ? 'border-accent bg-accent-wash text-ink' : 'border-rule text-ink-soft hover:text-ink'}`}
                >
                  {PHOTO_CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Ngày chụp">
            <Input type="date" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} />
          </Field>
        </div>

        <Field label="Vùng điều trị" hint="Gom nhóm ảnh trước/sau theo vùng, ví dụ: Mặt, Mũi, Cằm.">
          <Input value={bodyArea} onChange={(e) => setBodyArea(e.target.value)} placeholder="Mặt" maxLength={100} />
        </Field>
        <Field label="Chú thích" hint="Được lưu mã hoá cùng ảnh.">
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={500} />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!file}>Tải lên</Button>
        </div>
      </form>
    </DialogShell>
  );
}
