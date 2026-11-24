import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.store';
import { getErrorMessage } from '../lib/api-client';
import { Button, Input, Field, Alert } from '../components/ui';
import { AuthShell } from '../components/AuthShell';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((s) => s.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/dashboard';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const outcome = await login(email, password);
      if (outcome.kind === 'authenticated') {
        navigate(from, { replace: true });
      } else if (outcome.kind === 'mfa_required') {
        navigate('/mfa', { state: { mfaToken: outcome.mfaToken, from }, replace: true });
      } else {
        navigate('/mfa/dang-ky', { state: { enrollmentToken: outcome.enrollmentToken, from }, replace: true });
      }
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthShell
      step="Bước 1 / 2"
      title="Đăng nhập hệ thống"
      caption="Mọi truy cập đều được ghi nhật ký bất biến (Luật BVDLCN 2025)."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}

        <Field label="Email công vụ">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            placeholder="ten@crm-dk.local"
            invalid={!!error}
          />
        </Field>

        <Field label="Mật khẩu">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            invalid={!!error}
          />
        </Field>

        <Button type="submit" loading={busy} className="w-full">
          Tiếp tục
        </Button>

        <p className="rule-t pt-4 text-center text-xs text-ink-faint">
          Bạn là bệnh nhân?{' '}
          <a href="/portal/login" className="text-accent hover:underline">
            Vào cổng bệnh nhân
          </a>
        </p>
      </form>
    </AuthShell>
  );
}
