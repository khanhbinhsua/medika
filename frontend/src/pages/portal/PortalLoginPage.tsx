import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortalStore } from '../../stores/portal.store';
import { getErrorMessage } from '../../lib/api-client';
import { Button, Input, Field, Alert } from '../../components/ui';
import { PortalShell } from './PortalShell';

export function PortalLoginPage() {
  const navigate = useNavigate();
  const login = usePortalStore((s) => s.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      // Nếu buộc đổi mật khẩu, ProtectedRoute sẽ tự chuyển tới trang đổi.
      navigate('/portal', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <PortalShell title="Cổng bệnh nhân" caption="Đăng nhập để xem hồ sơ, lịch hẹn và kết quả của bạn.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required invalid={!!error} />
        </Field>
        <Field label="Mật khẩu">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required invalid={!!error} />
        </Field>
        <Button type="submit" loading={busy} className="w-full">
          Đăng nhập
        </Button>
        <p className="rule-t pt-4 text-xs leading-relaxed text-ink-faint">
          Chưa có tài khoản? Vui lòng liên hệ quầy lễ tân của phòng khám để được cấp.
        </p>
      </form>
    </PortalShell>
  );
}
