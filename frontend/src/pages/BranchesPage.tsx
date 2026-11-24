import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  fetchAllBranches,
  createBranch,
  updateBranch,
  fetchBranchUsers,
  assignUserToBranch,
  unassignUserFromBranch,
} from '../lib/branches';
import type { Branch } from '../lib/branches';
import { listUsers } from '../lib/users';
import { getErrorMessage } from '../lib/api-client';
import { Button, Field, Input, Alert, Badge, Skeleton } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { DialogShell } from '../components/DialogShell';

export function BranchesPage() {
  const branches = useQuery({ queryKey: ['branches-all'], queryFn: fetchAllBranches });
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Chi nhánh"
        meta="Cấu hình chi nhánh và phân công nhân viên — nền đa chi nhánh"
        action={<Button onClick={() => setShowCreate(true)}>+ Thêm chi nhánh</Button>}
      />
      {branches.isLoading && <Skeleton className="h-40" />}
      {branches.isError && <Alert>{getErrorMessage(branches.error)}</Alert>}
      <div className="space-y-2">{branches.data?.map((b) => <BranchRow key={b.id} branch={b} />)}</div>
      {showCreate && <CreateBranchDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function BranchRow({ branch }: { branch: Branch }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const toggleActive = useMutation({
    mutationFn: () => updateBranch(branch.id, { active: !branch.active }),
    onSuccess: () => { toast.success('Đã cập nhật'); void qc.invalidateQueries({ queryKey: ['branches-all'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="plate overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight">{branch.name}</span>
            {branch.code && <span className="tabular text-xs text-ink-soft">{branch.code}</span>}
            {branch.isDefault && <Badge tone="accent">Mặc định</Badge>}
            {!branch.active && <Badge tone="danger">Ngừng</Badge>}
          </div>
          {branch.address && <div className="text-xs text-ink-soft">{branch.address}</div>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-accent hover:underline">
            {open ? 'Đóng' : 'Nhân viên'}
          </button>
          {!branch.isDefault && (
            <button type="button" onClick={() => toggleActive.mutate()} className="text-xs text-ink-soft hover:underline">
              {branch.active ? 'Ngừng' : 'Bật'}
            </button>
          )}
        </div>
      </div>
      {open && <BranchStaff branchId={branch.id} />}
    </div>
  );
}

function BranchStaff({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const assigned = useQuery({ queryKey: ['branch-users', branchId], queryFn: () => fetchBranchUsers(branchId) });
  const allUsers = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const [pick, setPick] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['branch-users', branchId] });
  const assign = useMutation({
    mutationFn: (userId: string) => assignUserToBranch(branchId, userId),
    onSuccess: () => { toast.success('Đã phân công'); setPick(''); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => unassignUserFromBranch(branchId, userId),
    onSuccess: () => { toast.success('Đã gỡ'); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const assignedIds = new Set((assigned.data ?? []).map((u) => u.id));
  const candidates = (allUsers.data ?? []).filter((u) => !assignedIds.has(u.id));

  return (
    <div className="space-y-3 border-t border-rule bg-surface-sunk px-4 py-3">
      {assigned.isLoading ? (
        <Skeleton className="h-12" />
      ) : (assigned.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-soft">Chưa có nhân viên nào ở chi nhánh này.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {assigned.data!.map((u) => (
            <span key={u.id} className="flex items-center gap-1.5 rounded border border-rule bg-surface px-2 py-1 text-xs">
              {u.fullName}
              <button type="button" onClick={() => remove.mutate(u.id)} className="text-danger hover:underline" aria-label={`Gỡ ${u.fullName}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 flex-1 rounded border border-rule-strong bg-surface px-2 text-sm text-ink">
          <option value="">+ Thêm nhân viên…</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>
          ))}
        </select>
        <Button className="h-9 px-3 text-xs" disabled={!pick} loading={assign.isPending} onClick={() => pick && assign.mutate(pick)}>
          Phân công
        </Button>
      </div>
    </div>
  );
}

function CreateBranchDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => createBranch({ name: name.trim(), code: code.trim() || undefined, address: address.trim() || undefined, phone: phone.trim() || undefined }),
    onSuccess: () => { toast.success('Đã tạo chi nhánh'); void qc.invalidateQueries({ queryKey: ['branches-all'] }); void qc.invalidateQueries({ queryKey: ['my-branches'] }); onClose(); },
    onError: (e) => setError(getErrorMessage(e)),
  });

  return (
    <DialogShell eyebrow="Chi nhánh mới" title="Thêm chi nhánh" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); if (name.trim()) mutation.mutate(); }} className="space-y-4 p-5">
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tên chi nhánh *"><Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="VD: Chi nhánh Quận 1" /></Field>
          <Field label="Mã"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Q1" /></Field>
        </div>
        <Field label="Địa chỉ"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="Điện thoại"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 border-t border-rule pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!name.trim()}>Tạo chi nhánh</Button>
        </div>
      </form>
    </DialogShell>
  );
}
