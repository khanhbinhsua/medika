import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { listUsers, createUser, updateUser, resetPassword, resetMfa, ROLE_VI, STAFF_STATUS_VI } from '../lib/users';
import type { StaffUser, StaffRole, StaffStatus } from '../lib/users';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Button, Field, Alert, Badge, Skeleton, Input } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { DialogShell } from '../components/DialogShell';

const selectCls = 'h-9 rounded border border-rule-strong bg-surface px-2 text-sm text-ink';
const ROLES: StaffRole[] = ['admin', 'doctor', 'nurse', 'receptionist', 'auditor', 'sales', 'customer_care'];
const STATUS_TONE: Record<StaffStatus, 'ok' | 'warn' | 'danger'> = { active: 'ok', suspended: 'warn', disabled: 'danger' };

export function UsersPage() {
  const can = useAuthStore((s) => s.can);
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Tài khoản nhân viên"
        meta="Bác sĩ · điều dưỡng · lễ tân · kiểm toán — MFA đăng ký ở lần đăng nhập đầu"
        action={can('user:write') ? <Button onClick={() => setShowCreate(true)}>+ Tạo tài khoản</Button> : undefined}
      />
      {users.isLoading && <Skeleton className="h-64" />}
      {users.isError && <Alert>{getErrorMessage(users.error)}</Alert>}
      <div className="space-y-2">
        {users.data?.map((u) => <UserRow key={u.id} user={u} />)}
      </div>
      {showCreate && <CreateUserDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function UserRow({ user }: { user: StaffUser }) {
  const can = useAuthStore((s) => s.can);
  const me = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const isSelf = me?.id === user.id;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const changeRole = (role: StaffRole) => act.mutate(() => updateUser(user.id, { role }).then(() => toast.success('Đã đổi vai trò')));
  const changeStatus = (status: StaffStatus) =>
    act.mutate(() => updateUser(user.id, { status }).then(() => toast.success('Đã cập nhật trạng thái')));
  const doResetPw = () => {
    const pw = window.prompt('Mật khẩu mới (tối thiểu 12 ký tự):');
    if (pw) act.mutate(() => resetPassword(user.id, pw).then(() => toast.success('Đã đặt lại mật khẩu — nhân viên phải đăng nhập lại')));
  };
  const doResetMfa = () => {
    if (window.confirm(`Gỡ MFA của ${user.fullName}? Họ sẽ đăng ký lại ở lần đăng nhập kế tiếp.`))
      act.mutate(() => resetMfa(user.id).then(() => toast.success('Đã gỡ MFA')));
  };

  return (
    <div className="plate overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight">{user.fullName}</span>
            {isSelf && <span className="text-xs text-ink-soft">(bạn)</span>}
          </div>
          <div className="text-xs text-ink-soft">{user.email}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">{ROLE_VI[user.role] ?? user.role}</Badge>
          <Badge tone={STATUS_TONE[user.status]}>{STAFF_STATUS_VI[user.status]}</Badge>
          {!user.mfaEnabled && <Badge tone="warn">Chưa có MFA</Badge>}
          {can('user:write') && (
            <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-accent hover:underline">
              {open ? 'Đóng' : 'Quản lý'}
            </button>
          )}
        </div>
      </div>

      {open && can('user:write') && (
        <div className="space-y-3 border-t border-rule bg-surface-sunk px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-soft">Vai trò:</span>
              <select
                value={user.role}
                onChange={(e) => changeRole(e.target.value as StaffRole)}
                disabled={isSelf}
                className={selectCls}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_VI[r]}
                  </option>
                ))}
              </select>
            </label>
            {isSelf && <span className="text-xs text-ink-soft">Không thể tự đổi vai trò / trạng thái của mình.</span>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-soft">Trạng thái:</span>
            {(['active', 'suspended', 'disabled'] as StaffStatus[]).map((st) => (
              <button
                key={st}
                type="button"
                disabled={isSelf || user.status === st}
                onClick={() => changeStatus(st)}
                className={`rounded border px-2.5 py-1 text-xs ${
                  user.status === st ? 'border-accent text-accent' : 'border-rule-strong text-ink-soft hover:bg-surface'
                } disabled:opacity-40`}
              >
                {STAFF_STATUS_VI[st]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-rule pt-3">
            <Button variant="ghost" onClick={doResetPw}>
              Đặt lại mật khẩu
            </Button>
            <Button variant="ghost" onClick={doResetMfa}>
              Gỡ MFA
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<StaffRole>('doctor');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => createUser({ email: email.trim().toLowerCase(), fullName: fullName.trim(), role, password }),
    onSuccess: () => {
      toast.success('Đã tạo tài khoản — báo mật khẩu cho nhân viên để đăng nhập & đăng ký MFA');
      void qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  return (
    <DialogShell eyebrow="Tài khoản mới" title="Tạo tài khoản nhân viên" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
        className="space-y-4 p-5"
      >
        {error && <Alert>{error}</Alert>}
        <Field label="Họ tên *">
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="VD: BS. Nguyễn Văn A" />
        </Field>
        <Field label="Email công vụ *">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="ten@crm-dk.local" />
        </Field>
        <Field label="Vai trò *">
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className="h-10 w-full rounded border border-rule-strong bg-surface px-3 text-sm text-ink">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_VI[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mật khẩu tạm *" hint="Tối thiểu 12 ký tự. Nhân viên nên đổi sau khi đăng nhập.">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-rule pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={!fullName.trim() || !email.trim() || password.length < 12}>
            Tạo tài khoản
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
