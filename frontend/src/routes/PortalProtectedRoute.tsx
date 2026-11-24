import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { usePortalStore } from '../stores/portal.store';

export function PortalProtectedRoute() {
  const { patient, mustChangePassword, isBootstrapping } = usePortalStore();
  const location = useLocation();

  if (isBootstrapping) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="tabular text-xs uppercase tracking-[0.14em] text-ink-faint">Đang tải…</div>
      </div>
    );
  }

  if (!patient) return <Navigate to="/portal/login" replace />;

  // Buộc đổi mật khẩu lần đầu trước khi vào bất kỳ trang dữ liệu nào.
  if (mustChangePassword && location.pathname !== '/portal/doi-mat-khau') {
    return <Navigate to="/portal/doi-mat-khau" replace />;
  }

  return <Outlet />;
}
