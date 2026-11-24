import { useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore, ROLE_LABELS } from '../stores/auth.store';
import { cx } from './ui';
import { IdleGuard } from './IdleGuard';
import { ThemeToggle } from './ThemeToggle';
import { BranchSwitcher } from './BranchSwitcher';

type IconName =
  | 'dashboard' | 'patients' | 'calendar' | 'booking' | 'wallet' | 'clipboard'
  | 'survey' | 'megaphone' | 'bell' | 'chart' | 'users' | 'branch' | 'audit';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  permission?: string;
}
interface NavGroup {
  label?: string;
  items: NavItem[];
}

// Gom theo "hệ thống" cho dễ quét mắt thay vì một hàng dài.
const GROUPS: NavGroup[] = [
  { items: [{ to: '/dashboard', label: 'Tổng quan', icon: 'dashboard' }] },
  {
    label: 'Vận hành',
    items: [
      { to: '/benh-nhan', label: 'Bệnh nhân', icon: 'patients', permission: 'patient:read' },
      { to: '/lich-hen', label: 'Lịch hẹn', icon: 'calendar', permission: 'appointment:read' },
      { to: '/dat-lich-online', label: 'Đặt lịch online', icon: 'booking', permission: 'booking:manage' },
    ],
  },
  {
    label: 'Chăm sóc khách hàng',
    items: [
      { to: '/chi-tieu', label: 'Chi tiêu KH', icon: 'wallet', permission: 'spending:read' },
      { to: '/phac-do', label: 'Phác đồ', icon: 'clipboard', permission: 'treatment:read' },
      { to: '/khao-sat', label: 'Khảo sát', icon: 'survey', permission: 'survey:read' },
      { to: '/marketing', label: 'Marketing', icon: 'megaphone', permission: 'marketing:read' },
      { to: '/thong-bao', label: 'Thông báo', icon: 'bell', permission: 'notification:manage' },
    ],
  },
  {
    label: 'Phân tích',
    items: [{ to: '/bao-cao', label: 'Báo cáo', icon: 'chart', permission: 'report:read' }],
  },
  {
    label: 'Quản trị',
    items: [
      { to: '/nhan-vien', label: 'Nhân viên', icon: 'users', permission: 'user:read' },
      { to: '/chi-nhanh', label: 'Chi nhánh', icon: 'branch', permission: 'branch:manage' },
      { to: '/nhat-ky', label: 'Nhật ký kiểm toán', icon: 'audit', permission: 'audit:read' },
    ],
  },
];

export function AppLayout() {
  const navigate = useNavigate();
  const { user, can, logout } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => !it.permission || can(it.permission)),
  })).filter((g) => g.items.length > 0);

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-full">
      <IdleGuard />

      {/* Sidebar — cố định trên desktop */}
      <Sidebar groups={groups} className="hidden lg:flex" />

      {/* Drawer trên mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <Sidebar groups={groups} className="float-3 absolute inset-y-0 left-0 flex w-64" onNavigate={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Cột nội dung */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="float-1 sticky top-0 z-20 border-b border-rule bg-surface/80 backdrop-blur-md">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-md border border-rule-strong p-1.5 text-ink-soft hover:bg-surface-sunk lg:hidden"
              aria-label="Mở menu"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 4h12M2 8h12M2 12h12" strokeLinecap="round" />
              </svg>
            </button>

            <div className="flex items-center gap-2 lg:hidden">
              <Mark className="h-5 w-5" />
              <span className="text-sm font-semibold tracking-tight">CRM Y Tế</span>
            </div>

            <div className="flex-1" />

            <BranchSwitcher />
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
                className="rounded-md border border-rule-strong px-2.5 py-1.5 text-xs text-ink-soft transition-colors duration-150 hover:bg-surface-sunk hover:text-ink"
              >
                Đăng xuất
              </button>
            </div>
          </div>
        </header>

        <main className="rise flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>

        <footer className="border-t border-rule px-4 py-3 sm:px-6">
          <p className="tabular text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            Dữ liệu được mã hoá · Mọi truy cập đều được ghi nhật ký
          </p>
        </footer>
      </div>
    </div>
  );
}

function Sidebar({
  groups,
  className,
  onNavigate,
}: {
  groups: NavGroup[];
  className?: string;
  onNavigate?: () => void;
}) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  return (
    <aside className={cx('w-60 shrink-0 flex-col border-r border-rule bg-surface lg:sticky lg:top-0 lg:h-screen', className)}>
      {/* Thương hiệu */}
      <div className="flex h-14 items-center gap-2.5 border-b border-rule px-4">
        <Mark className="h-6 w-6" />
        <div className="min-w-0 leading-tight">
          <div className="text-sm font-semibold tracking-tight text-ink">CRM Y Tế</div>
          <div className="tabular text-[9px] uppercase tracking-[0.14em] text-ink-faint">Hệ thống nội bộ</div>
        </div>
      </div>

      {/* Điều hướng theo nhóm */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Điều hướng chính">
        {groups.map((group, gi) => (
          <div key={group.label ?? gi}>
            {group.label && <div className="field-label px-3 pb-1.5">{group.label}</div>}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cx(
                      'group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-150',
                      isActive
                        ? 'bg-accent-wash font-medium text-accent'
                        : 'text-ink-soft hover:bg-surface-sunk hover:text-ink',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {/* Vạch nhấn teal — motif "khí cụ" nhất quán toàn app */}
                      <span
                        className={cx(
                          'absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-accent transition-opacity duration-150',
                          isActive ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden="true"
                      />
                      <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Người dùng (hiện ở sidebar khi màn hẹp không có ở topbar) */}
      <div className="border-t border-rule p-3 sm:hidden">
        <div className="truncate px-2 text-xs font-medium text-ink">{user?.fullName}</div>
        <div className="tabular px-2 text-[10px] uppercase tracking-wider text-ink-faint">
          {ROLE_LABELS[user?.role ?? ''] ?? user?.role}
        </div>
        <button
          onClick={() => void logout().then(() => navigate('/login', { replace: true }))}
          className="mt-2 w-full rounded-md border border-rule-strong px-2.5 py-1.5 text-xs text-ink-soft hover:bg-surface-sunk hover:text-ink"
        >
          Đăng xuất
        </button>
      </div>
    </aside>
  );
}

/** Dấu hiệu nhận diện: chữ thập y tế dựng từ nét kẻ. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="0.5" y="0.5" width="23" height="23" fill="none" stroke="rgb(var(--rule-strong))" />
      <path d="M12 5.5v13M5.5 12h13" stroke="rgb(var(--accent))" strokeWidth="2.5" strokeLinecap="square" />
    </svg>
  );
}

/** Icon nét mảnh (stroke) hợp ngôn ngữ "khí cụ lâm sàng" — không dùng icon đặc bo tròn. */
function Icon({ name, className }: { name: IconName; className?: string }) {
  const p: Record<IconName, ReactNode> = {
    dashboard: (<><rect x="2.25" y="2.25" width="4.5" height="4.5" rx="1" /><rect x="9.25" y="2.25" width="4.5" height="4.5" rx="1" /><rect x="2.25" y="9.25" width="4.5" height="4.5" rx="1" /><rect x="9.25" y="9.25" width="4.5" height="4.5" rx="1" /></>),
    patients: (<><circle cx="8" cy="5" r="2.5" /><path d="M3.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" /></>),
    calendar: (<><rect x="2.5" y="3.25" width="11" height="10.25" rx="1.25" /><path d="M2.5 6.5h11M5.25 2v2.25M10.75 2v2.25" /></>),
    booking: (<><rect x="2.5" y="3.25" width="11" height="10.25" rx="1.25" /><path d="M2.5 6.5h11M8 8.75v3M6.5 10.25h3" /></>),
    wallet: (<><rect x="2" y="3.75" width="12" height="8.5" rx="1.5" /><path d="M10.25 8h2.25" /><path d="M2 6h8.5" /></>),
    clipboard: (<><rect x="3.75" y="3" width="8.5" height="11" rx="1.25" /><path d="M6 3V1.75h4V3M6.25 7h3.5M6.25 10h3.5" /></>),
    survey: (<path d="M8 2.2l1.7 3.5 3.8.5-2.75 2.65.66 3.8L8 11.3 4.59 12.4l.66-3.8L2.5 6.2l3.8-.5z" />),
    megaphone: (<><path d="M3 7v2.5l8 3.2V3.8L3 7z" /><path d="M3 7H2a1 1 0 0 0-1 1v.5a1 1 0 0 0 1 1h1M11 5.5c1.6.6 1.6 4.4 0 5" /></>),
    bell: (<><path d="M8 2.2a3.6 3.6 0 0 0-3.6 3.6c0 3.2-1.4 4.2-1.4 4.2h10s-1.4-1-1.4-4.2A3.6 3.6 0 0 0 8 2.2z" /><path d="M6.6 12.4a1.5 1.5 0 0 0 2.8 0" /></>),
    chart: (<path d="M2.5 2.5v11h11M5.5 11V8M8 11V5.5M10.5 11V7" />),
    users: (<><circle cx="6" cy="5.5" r="2" /><path d="M2.5 13c0-2 1.6-3.4 3.5-3.4S9.5 11 9.5 13" /><path d="M10.5 4a2 2 0 0 1 0 4M11 9.7c1.6.35 2.5 1.6 2.5 3.3" /></>),
    branch: (<path d="M2.5 13.5h11M4 13.5V5l4-2.5L12 5v8.5M6.5 13.5V10.5h3v3" />),
    audit: (<><path d="M8 2l5 2v3.6c0 3-2.2 5.1-5 5.9-2.8-.8-5-2.9-5-5.9V4z" /><path d="M6 8l1.4 1.4L10.4 6.4" /></>),
  };
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p[name]}
    </svg>
  );
}
