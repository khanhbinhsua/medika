import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { MfaVerifyPage } from './pages/MfaVerifyPage';
import { MfaEnrollPage } from './pages/MfaEnrollPage';
import { DashboardPage } from './pages/DashboardPage';
import { PatientsPage } from './pages/PatientsPage';
import { PatientDetailPage } from './pages/PatientDetailPage';
import { DeletedPatientsPage } from './pages/DeletedPatientsPage';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { AuditPage } from './pages/AuditPage';
import { ReportsPage } from './pages/ReportsPage';
import { TreatmentPlansPage } from './pages/TreatmentPlansPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { MarketingPage } from './pages/MarketingPage';
import { SurveysPage } from './pages/SurveysPage';
import { SpendingPage } from './pages/SpendingPage';
import { BranchesPage } from './pages/BranchesPage';
import { UsersPage } from './pages/UsersPage';
import { PublicSurveyPage } from './pages/PublicSurveyPage';
import { useAuthStore } from './stores/auth.store';
import { usePortalStore } from './stores/portal.store';
import { PortalProtectedRoute } from './routes/PortalProtectedRoute';
import { PortalLoginPage } from './pages/portal/PortalLoginPage';
import { PortalChangePasswordPage } from './pages/portal/PortalChangePasswordPage';
import { PortalDashboard } from './pages/portal/PortalDashboard';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      // PHI không nằm lâu trong bộ nhớ trình duyệt sau khi rời màn hình
      gcTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="plate max-w-md p-8 text-center">
        <div className="tabular field-label text-accent">404</div>
        <h1 className="mt-2 text-lg font-semibold tracking-tight">Không tìm thấy trang</h1>
        <Link to="/dashboard" className="mt-4 inline-block text-sm text-accent hover:underline">
          Về trang tổng quan
        </Link>
      </div>
    </div>
  );
}

function Forbidden() {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="plate max-w-md p-8 text-center">
        <div className="tabular field-label text-danger">403</div>
        <h1 className="mt-2 text-lg font-semibold tracking-tight">Không đủ quyền truy cập</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Vai trò của bạn không được cấp quyền cho chức năng này. Lượt truy cập đã được ghi nhật ký.
        </p>
        <Link to="/dashboard" className="mt-4 inline-block text-sm text-accent hover:underline">
          Về trang tổng quan
        </Link>
      </div>
    </div>
  );
}

function App() {
  const bootstrapStaff = useAuthStore((s) => s.bootstrap);
  const bootstrapPortal = usePortalStore((s) => s.bootstrap);

  useEffect(() => {
    // Bootstrap đúng store theo khu vực — không nạp phiên nhân viên khi đang ở
    // cổng bệnh nhân và ngược lại, tránh gọi refresh chéo vô ích.
    const isPortal = window.location.pathname.startsWith('/portal');
    if (isPortal) void bootstrapPortal();
    else void bootstrapStaff();
  }, [bootstrapStaff, bootstrapPortal]);

  return (
    <BrowserRouter>
      <Routes>
        {/* Cổng bệnh nhân — tách biệt hoàn toàn với khu vực nhân viên */}
        <Route path="/portal/login" element={<PortalLoginPage />} />
        <Route element={<PortalProtectedRoute />}>
          <Route path="/portal/doi-mat-khau" element={<PortalChangePasswordPage />} />
          <Route path="/portal" element={<PortalDashboard />} />
        </Route>

        {/* Khảo sát công khai — bệnh nhân mở bằng link, KHÔNG cần đăng nhập */}
        <Route path="/survey/:token" element={<PublicSurveyPage />} />

        <Route path="/login" element={<LoginPage />} />
        <Route path="/mfa" element={<MfaVerifyPage />} />
        <Route path="/mfa/dang-ky" element={<MfaEnrollPage />} />
        <Route path="/403" element={<Forbidden />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />

            <Route element={<ProtectedRoute requiredPermissions={['patient:read']} />}>
              <Route path="/benh-nhan" element={<PatientsPage />} />
              <Route path="/benh-nhan/:patientId" element={<PatientDetailPage />} />
            </Route>

            <Route element={<ProtectedRoute requiredPermissions={['patient:purge']} />}>
              <Route path="/benh-nhan/da-xoa" element={<DeletedPatientsPage />} />
            </Route>

            <Route element={<ProtectedRoute requiredPermissions={['appointment:read']} />}>
              <Route path="/lich-hen" element={<AppointmentsPage />} />
            </Route>

            <Route element={<ProtectedRoute requiredPermissions={['report:read']} />}>
              <Route path="/bao-cao" element={<ReportsPage />} />
            </Route>

            <Route element={<ProtectedRoute requiredPermissions={['treatment:read']} />}>
              <Route path="/phac-do" element={<TreatmentPlansPage />} />
            </Route>

            <Route element={<ProtectedRoute requiredPermissions={['notification:manage']} />}>
              <Route path="/thong-bao" element={<NotificationsPage />} />
            </Route>

            <Route element={<ProtectedRoute requiredPermissions={['marketing:read']} />}>
              <Route path="/marketing" element={<MarketingPage />} />
            </Route>

            <Route element={<ProtectedRoute requiredPermissions={['survey:read']} />}>
              <Route path="/khao-sat" element={<SurveysPage />} />
            </Route>

            <Route element={<ProtectedRoute requiredPermissions={['spending:read']} />}>
              <Route path="/chi-tieu" element={<SpendingPage />} />
            </Route>



            <Route element={<ProtectedRoute requiredPermissions={['user:read']} />}>
              <Route path="/nhan-vien" element={<UsersPage />} />
            </Route>

            <Route element={<ProtectedRoute requiredPermissions={['branch:manage']} />}>
              <Route path="/chi-nhanh" element={<BranchesPage />} />
            </Route>

            <Route element={<ProtectedRoute requiredPermissions={['audit:read']} />}>
              <Route path="/nhat-ky" element={<AuditPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>

      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'rgb(var(--surface))',
            color: 'rgb(var(--ink))',
            border: '1px solid rgb(var(--rule))',
            borderRadius: '2px',
            fontSize: '14px',
          },
        }}
      />
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
