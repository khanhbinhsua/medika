import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPatient, fullName, ageFrom, formatDate, GENDER_LABELS, STATUS_LABELS } from '../lib/patients';
import { fetchConditions, SEVERITY_VI } from '../lib/conditions';
import { getErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../stores/auth.store';
import { Alert, Badge, Button, DataPlate, Skeleton } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { PatientKpiTiles } from '../components/PatientKpiTiles';
import { PatientClinicalTabs } from '../components/PatientClinicalTabs';
import { PatientConsents } from '../components/PatientConsents';
import { DeletePatientDialog } from '../components/DeletePatientDialog';

export function PatientDetailPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [deleting, setDeleting] = useState(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => fetchPatient(patientId!),
    enabled: !!patientId,
  });

  const conditions = useQuery({
    queryKey: ['conditions', patientId],
    queryFn: () => fetchConditions(patientId!),
    enabled: !!patientId && can('condition:read'),
  });
  const allergies = conditions.data?.allergies ?? [];

  if (isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <Alert>{getErrorMessage(error)}</Alert>
        <Link to="/benh-nhan" className="mt-4 inline-block text-sm text-accent hover:underline">
          ← Quay lại danh sách
        </Link>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const age = ageFrom(data.dob);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link to="/benh-nhan" className="inline-block text-xs text-ink-faint hover:text-ink">
        ← Danh sách bệnh nhân
      </Link>

      <PageHeader
        eyebrow={data.mrn}
        title={fullName(data)}
        meta={`${age !== null ? `${age} tuổi` : ''}${age !== null && data.gender ? ' · ' : ''}${
          GENDER_LABELS[data.gender ?? ''] ?? ''
        }`}
        action={
          <Badge tone={data.status === 'active' ? 'ok' : 'neutral'}>
            {STATUS_LABELS[data.status] ?? data.status}
          </Badge>
        }
      />

      {/* Cảnh báo dị ứng — đập vào mắt ngay đầu hồ sơ (S11 · must) */}
      {allergies.length > 0 && (
        <Alert tone="warn">
          <span className="font-semibold">⚠ Dị ứng:</span>{' '}
          {allergies
            .map((a) => `${a.allergyName}${a.severity ? ` (${SEVERITY_VI[a.severity] ?? a.severity})` : ''}`)
            .join(' · ')}
        </Alert>
      )}

      {/* 4 ô chỉ số: chi tiêu · công nợ · buổi còn lại · lượt đến */}
      <PatientKpiTiles patientId={data.id} />

      {/* Tấm định danh: cụm thông tin cần liếc là thấy, đặt ngay đầu trang */}
      <section className="plate">
        <SectionHead>Định danh</SectionHead>
        <div className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-3">
          <DataPlate label="Mã hồ sơ" value={data.mrn} />
          <DataPlate label="Ngày sinh" value={formatDate(data.dob)} />
          <DataPlate label="Mã bảo hiểm" value={data.insuranceId} />
        </div>
      </section>

      <section className="plate">
        <SectionHead>Liên hệ</SectionHead>
        <div className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-3">
          <DataPlate label="Số điện thoại" value={data.phone} />
          <DataPlate label="Email" value={data.email} mono={false} />
          <DataPlate label="Địa chỉ" value={data.address} mono={false} />
        </div>
      </section>

      <section className="plate">
        <SectionHead>Nhật ký hồ sơ</SectionHead>
        <div className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2">
          <DataPlate label="Tạo lúc" value={new Date(data.createdAt).toLocaleString('vi-VN')} />
          <DataPlate label="Cập nhật lần cuối" value={new Date(data.updatedAt).toLocaleString('vi-VN')} />
        </div>
      </section>

      <div className="plate bg-surface-sunk p-4">
        <p className="text-xs leading-relaxed text-ink-faint">
          Lượt xem hồ sơ này đã được ghi vào nhật ký truy cập PHI, kèm tài khoản, thời điểm và các trường đã giải mã.
        </p>
      </div>

      <PatientClinicalTabs patientId={data.id} />

      <PatientConsents patientId={data.id} />

      {can('patient:delete') && (
        <div className="flex justify-end border-t border-rule pt-4">
          <Button variant="danger" className="h-8 px-3 text-xs" onClick={() => setDeleting(true)}>
            Xoá hồ sơ
          </Button>
        </div>
      )}

      {deleting && (
        <DeletePatientDialog
          patient={data}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            void queryClient.invalidateQueries({ queryKey: ['patients'] });
            navigate('/benh-nhan', { replace: true });
          }}
        />
      )}
    </div>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="field-label border-b border-rule bg-surface-sunk px-4 py-2">{children}</h2>
  );
}
