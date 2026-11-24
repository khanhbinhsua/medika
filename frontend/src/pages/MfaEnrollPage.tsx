import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { useAuthStore } from '../stores/auth.store';
import { getErrorMessage } from '../lib/api-client';
import { Button, Alert, Skeleton } from '../components/ui';
import { AuthShell } from '../components/AuthShell';
import { CodeInput } from '../components/CodeInput';

type Stage = 'loading' | 'scan' | 'codes' | 'error';

export function MfaEnrollPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { startEnrollment, confirmEnrollment } = useAuthStore();

  const state = location.state as { enrollmentToken?: string; from?: string } | null;
  const token = state?.enrollmentToken;

  const [stage, setStage] = useState<Stage>('loading');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      try {
        const { otpauthUrl, recoveryCodes: codes } = await startEnrollment(token);
        if (cancelled) return;

        // QR sinh ngay trong trình duyệt — secret không đi qua dịch vụ bên thứ ba.
        const dataUrl = await QRCode.toDataURL(otpauthUrl, {
          margin: 1,
          width: 400,
          errorCorrectionLevel: 'M',
          color: { dark: '#0f1720', light: '#ffffff' },
        });
        if (cancelled) return;

        setQrDataUrl(dataUrl);
        setManualKey(new URL(otpauthUrl).searchParams.get('secret'));
        setRecoveryCodes(codes);
        setStage('scan');
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err));
          setStage('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, startEnrollment]);

  if (!token) return <Navigate to="/login" replace />;

  async function submit(value: string) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await confirmEnrollment(token!, value);
      setStage('codes');
    } catch (err) {
      setError(getErrorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'codes') {
    return (
      <AuthShell
        step="Hoàn tất"
        title="Lưu mã khôi phục"
        caption="Đây là lần duy nhất các mã này được hiển thị. Sau khi rời trang, chúng không thể xem lại."
        wide
      >
        <div className="space-y-5">
          <Alert tone="warn">
            In ra hoặc cất vào trình quản lý mật khẩu. Không lưu chung nơi với thiết bị chứa ứng dụng Authenticator.
          </Alert>

          <ul className="plate grid grid-cols-2 gap-x-6 gap-y-2 bg-surface-sunk p-4 sm:grid-cols-2">
            {recoveryCodes.map((c, i) => (
              <li key={c} className="tabular flex items-baseline gap-3 text-sm text-ink">
                <span className="w-5 shrink-0 text-right text-[10px] text-ink-faint">{i + 1}</span>
                <span className="tracking-wider">{c}</span>
              </li>
            ))}
          </ul>

          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
            />
            <span>Tôi đã lưu các mã khôi phục ở nơi an toàn.</span>
          </label>

          <Button
            disabled={!acknowledged}
            onClick={() => navigate(state?.from ?? '/dashboard', { replace: true })}
            className="w-full"
          >
            Vào hệ thống
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      step="Thiết lập"
      title="Kích hoạt xác thực hai bước"
      caption="Bắt buộc với mọi tài khoản trước khi truy cập dữ liệu bệnh nhân."
      wide
    >
      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}

        <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="plate mx-auto h-[168px] w-[168px] shrink-0 bg-white p-2 sm:mx-0">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Mã QR thiết lập xác thực hai bước" className="h-full w-full" />
            ) : (
              <Skeleton className="h-full w-full" />
            )}
          </div>

          <ol className="space-y-3 text-sm text-ink-soft">
            <Step n={1}>
              Cài ứng dụng xác thực: <span className="text-ink">Google Authenticator</span>,{' '}
              <span className="text-ink">Microsoft Authenticator</span> hoặc <span className="text-ink">1Password</span>.
            </Step>
            <Step n={2}>Quét mã QR bên cạnh bằng ứng dụng đó.</Step>
            <Step n={3}>Nhập mã 6 chữ số đang hiển thị để xác nhận.</Step>

            {manualKey && (
              <li className="rule-t pt-3">
                <div className="field-label">Không quét được? Nhập tay khoá này</div>
                <code className="tabular mt-1 block break-all text-[11px] leading-relaxed text-ink">{manualKey}</code>
              </li>
            )}
          </ol>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(code);
          }}
          className="rule-t space-y-4 pt-5"
        >
          <div>
            <span className="field-label">Mã xác nhận từ ứng dụng</span>
            <div className="mt-1.5">
              <CodeInput
                value={code}
                onChange={setCode}
                onComplete={(v) => void submit(v)}
                disabled={busy || stage !== 'scan'}
                invalid={!!error}
              />
            </div>
          </div>

          <Button type="submit" loading={busy} disabled={stage !== 'scan'} className="w-full">
            Kích hoạt và đăng nhập
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="tabular mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border border-rule-strong text-[10px] font-semibold text-ink-soft">
        {n}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}
