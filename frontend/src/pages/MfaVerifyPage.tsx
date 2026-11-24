import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.store';
import { getErrorMessage } from '../lib/api-client';
import { Button, Input, Field, Alert } from '../components/ui';
import { AuthShell } from '../components/AuthShell';
import { CodeInput } from '../components/CodeInput';

export function MfaVerifyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { verifyMfa, verifyRecoveryCode } = useAuthStore();

  const state = location.state as { mfaToken?: string; from?: string } | null;
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Vào thẳng URL này mà không qua bước mật khẩu thì không có token — quay lại đầu.
  if (!state?.mfaToken) return <Navigate to="/login" replace />;

  const target = state.from ?? '/dashboard';

  async function submit(value: string) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (useRecovery) {
        await verifyRecoveryCode(state!.mfaToken!, value);
      } else {
        await verifyMfa(state!.mfaToken!, value);
      }
      navigate(target, { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
      setCode('');
      setBusy(false);
    }
  }

  return (
    <AuthShell
      step="Bước 2 / 2"
      title="Xác thực hai bước"
      caption={
        useRecovery
          ? 'Nhập một mã khôi phục đã được cấp khi thiết lập.'
          : 'Mở ứng dụng Authenticator và nhập mã 6 chữ số đang hiển thị.'
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(useRecovery ? recoveryCode : code);
        }}
        className="space-y-5"
      >
        {error && <Alert>{error}</Alert>}

        {useRecovery ? (
          <Field label="Mã khôi phục" hint="Mỗi mã chỉ dùng được một lần.">
            <Input
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
              placeholder="XXXXX-XXXXX"
              className="tabular tracking-widest"
              autoFocus
              invalid={!!error}
            />
          </Field>
        ) : (
          <div>
            <span className="field-label">Mã xác thực</span>
            <div className="mt-1.5">
              <CodeInput
                value={code}
                onChange={setCode}
                onComplete={(v) => void submit(v)}
                disabled={busy}
                invalid={!!error}
                autoFocus
              />
            </div>
          </div>
        )}

        <Button type="submit" loading={busy} className="w-full">
          Xác nhận
        </Button>

        <div className="rule-t flex flex-wrap items-center justify-between gap-2 pt-4 text-xs">
          <button
            type="button"
            onClick={() => {
              setUseRecovery((v) => !v);
              setError(null);
            }}
            className="text-accent hover:underline"
          >
            {useRecovery ? 'Dùng mã từ ứng dụng Authenticator' : 'Mất thiết bị? Dùng mã khôi phục'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="text-ink-faint hover:text-ink"
          >
            Đăng nhập bằng tài khoản khác
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
