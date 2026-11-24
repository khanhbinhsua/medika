import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.store';

interface Props {
  /** Người dùng phải có TẤT CẢ quyền này mới vào được. */
  requiredPermissions?: string[];
}

export function ProtectedRoute({ requiredPermissions = [] }: Props) {
  const { user, isBootstrapping, can } = useAuthStore();
  const location = useLocation();

  // Trong lúc thử refresh token, chưa kết luận được là đã đăng nhập hay chưa —
  // điều hướng sớm ở đây sẽ đá người dùng ra ngoài mỗi lần tải lại trang.
  if (isBootstrapping) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="tabular text-xs uppercase tracking-[0.14em] text-ink-faint">Đang tải…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredPermissions.some((p) => !can(p))) {
    return <Navigate to="/403" replace />;
  }

  return <Outlet />;
}
