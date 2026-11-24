import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortalStore } from '../../stores/portal.store';
import { getErrorMessage } from '../../lib/api-client';
import { Button, Input, Field, Alert } from '../../components/ui';
import { PortalShell } from './PortalShell';

export function PortalChangePasswordPage() {
  const navigate = useNavigate();
  const changePassword = usePortalStore((s) => s.changePassword);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError('Mật khẩu mới nhập lại không khớp');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await changePassword(current, next);
      // Đổi mật khẩu thu hồi phiên — quay lại đăng nhập với mật khẩu mới.
      navigate('/portal/login', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <PortalShell title="Đổi mật khẩu" caption="Vui lòng đặt mật khẩu mới cho lần đăng nhập đầu tiên.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Mật khẩu hiện tại (tạm)">
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
        </Field>
        <Field label="Mật khẩu mới" hint="Tối thiểu 12 ký tự.">
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
        </Field>
        <Field label="Nhập lại mật khẩu mới">
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required invalid={!!confirm && confirm !== next} />
        </Field>
        <Button type="submit" loading={busy} className="w-full" disabled={!current || next.length < 12 || next !== confirm}>
          Đổi mật khẩu
        </Button>
      </form>
    </PortalShell>
  );
}
