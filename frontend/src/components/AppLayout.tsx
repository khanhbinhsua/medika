import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore, ROLE_LABELS } from '../stores/auth.store';
import { cx } from './ui';
import { IdleGuard } from './IdleGuard';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  to: string;
  label: string;
  permission?: string;
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Tổng quan' },
  { to: '/benh-nhan', label: 'Bệnh nhân', permission: 'patient:read' },
  { to: '/lich-hen', label: 'Lịch hẹn', permission: 'appointment:read' },
  { to: '/chi-tieu', label: 'Chi tiêu KH', permission: 'spending:read' },
  { to: '/phac-do', label: 'Phác đồ', permission: 'treatment:read' },
  { to: '/khao-sat', label: 'Khảo sát', permission: 'survey:read' },
  { to: '/marketing', label: 'Marketing', permission: 'marketing:read' },
  { to: '/thong-bao', label: 'Thông báo', permission: 'notification:manage' },
  { to: '/bao-cao', label: 'Báo cáo', permission: 'report:read' },
  { to: '/nhan-vien', label: 'Nhân viên', permission: 'user:read' },
  { to: '/nhat-ky', label: 'Nhật ký kiểm toán', permission: 'audit:read' },
];

export function AppLayout() {
  const navigate = useNavigate();
  const { user, can, logout } = useAuthStore();

  const visible = NAV.filter((item) => !item.permission || can(item.permission));

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-full flex-col">
      <IdleGuard />

      <header className="sticky top-0 z-20 border-b border-rule bg-surface/95 backdrop-blur">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
              <rect x="0.5" y="0.5" width="23" height="23" fill="none" stroke="rgb(var(--rule-strong))" />
              <path d="M12 5.5v13M5.5 12h13" stroke="rgb(var(--accent))" strokeWidth="2.5" strokeLinecap="square" />
            </svg>
            <span className="text-sm font-semibold tracking-tight">CRM Y Tế</span>
          </div>

          <nav className="ml-2 flex flex-1 items-center gap-0.5 overflow-x-auto" aria-label="Điều hướng chính">
            {visible.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cx(
                    'relative whitespace-nowrap px-3 py-2 text-sm transition-colors duration-150',
                    isActive ? 'font-medium text-ink' : 'text-ink-soft hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {item.label}
                    {/* Gạch chân là chỉ báo trạng thái, không dùng nền bo tròn */}
                    <span
                      className={cx(
                        'absolute inset-x-2 -bottom-px h-0.5 transition-opacity duration-150',
                        isActive ? 'bg-accent opacity-100' : 'opacity-0',
                      )}
                    />
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <ThemeToggle />

          <div className="hidden min-w-0 items-center gap-3 border-l border-rule pl-4 sm:flex">
            <div className="min-w-0 text-right">
              <div className="truncate text-xs font-medium text-ink">{user?.fullName}</div>
              <div className="tabular text-[10px] uppercase tracking-wider text-ink-faint">
                {ROLE_LABELS[user?.role ?? ''] ?? user?.role}
              </div>
            </div>
            <button
              onClick={() => void onLogout()}
              className="rounded border border-rule-strong px-2.5 py-1.5 text-xs text-ink-soft transition-colors duration-150 hover:bg-surface-sunk hover:text-ink"
            >
              Đăng xuất
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-rule px-4 py-3 sm:px-6">
        <p className="tabular text-[10px] uppercase tracking-[0.12em] text-ink-faint">
          Dữ liệu được mã hoá · Mọi truy cập đều được ghi nhật ký
        </p>
      </footer>
    </div>
  );
}
