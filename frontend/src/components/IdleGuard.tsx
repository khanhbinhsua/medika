import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.store';
import { Button } from './ui';

const IDLE_LIMIT_MS = 30 * 60 * 1000; // khớp SESSION_IDLE_TIMEOUT_SECONDS phía server
const WARN_BEFORE_MS = 2 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'pointerdown'] as const;

/**
 * Tự đăng xuất sau 30 phút không hoạt động — HIPAA §164.312(a)(2)(iii).
 * Server mới là nơi cưỡng chế thật; phần này chỉ để người dùng không bị mất
 * việc đang làm một cách đột ngột, và để màn hình không nằm mở với PHI.
 */
export function IdleGuard() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    const bump = () => {
      lastActivity.current = Date.now();
      setRemainingMs((prev) => (prev === null ? null : null));
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, bump, { passive: true });
    }

    const tick = window.setInterval(() => {
      const idle = Date.now() - lastActivity.current;

      if (idle >= IDLE_LIMIT_MS) {
        void logout().then(() => navigate('/login', { replace: true, state: { reason: 'idle' } }));
        return;
      }

      setRemainingMs(idle >= IDLE_LIMIT_MS - WARN_BEFORE_MS ? IDLE_LIMIT_MS - idle : null);
    }, 1000);

    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, bump);
      window.clearInterval(tick);
    };
  }, [logout, navigate]);

  if (remainingMs === null) return null;

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      className="fixed inset-x-0 top-0 z-50 border-b border-warn/40 bg-warn-wash"
    >
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm text-warn">
        <span>
          Phiên làm việc sẽ tự kết thúc sau <span className="tabular font-semibold">{mm}:{ss}</span> do không có
          hoạt động.
        </span>
        <Button
          variant="ghost"
          className="h-8 border-warn/40 px-3 text-xs text-warn hover:bg-warn/10"
          onClick={() => {
            lastActivity.current = Date.now();
            setRemainingMs(null);
          }}
        >
          Tiếp tục làm việc
        </Button>
      </div>
    </div>
  );
}
