import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchEncounters, createEncounter, ENCOUNTER_STATUS_VI, ENCOUNTER_STATUS_TONE } from '../lib/encounters';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Alert, Badge, Skeleton } from './ui';
import { ExamDialog } from './ExamDialog';

export function BenhAnTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const canWrite = useAuthStore((s) => s.can)('encounter:write');
  const list = useQuery({ queryKey: ['encounters', patientId], queryFn: () => fetchEncounters(patientId) });
  const [openId, setOpenId] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['encounters', patientId] });

  const create = useMutation({
    mutationFn: () => createEncounter(patientId),
    onSuccess: (e) => { setOpenId(e.id); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex justify-end">
          <Button className="h-8 px-3 text-xs" loading={create.isPending} onClick={() => create.mutate()}>+ Bệnh án mới (15/BV1)</Button>
        </div>
      )}
      {list.isLoading ? (
        <Skeleton className="h-24" />
      ) : list.isError ? (
        <Alert>{getErrorMessage(list.error)}</Alert>
      ) : list.data && list.data.length > 0 ? (
        <div className="divide-y divide-rule rounded-lg border border-rule">
          {list.data.map((e) => (
            <button key={e.id} type="button" onClick={() => setOpenId(e.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-sunk">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="tabular text-xs text-ink-faint">{new Date(e.createdAt).toLocaleDateString('vi-VN')}</span>
                  <Badge tone={ENCOUNTER_STATUS_TONE[e.status] ?? 'neutral'}>{ENCOUNTER_STATUS_VI[e.status] ?? e.status}</Badge>
                  {e.dxPrimaryIcd10 && <span className="tabular text-xs text-accent">{e.dxPrimaryIcd10}</span>}
                </div>
                <div className="truncate text-ink-soft">{e.dxName ?? 'Chưa có chẩn đoán'} · {e.doctorName}</div>
              </div>
              <span className="text-xs text-accent">Mở →</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-ink-soft">Chưa có bệnh án nào.</p>
      )}
      {openId && <ExamDialog encounterId={openId} onClose={() => setOpenId(null)} onChanged={invalidate} />}
    </div>
  );
}
