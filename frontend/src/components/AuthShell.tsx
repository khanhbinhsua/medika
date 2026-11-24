import type { ReactNode } from 'react';

/**
 * Khung cho các màn hình xác thực. Bố cục hai cột: bảng nhận diện hệ thống
 * bên trái (ngôn ngữ của tem mẫu bệnh phẩm — kẻ tóc, chữ đều nét, không đổ
 * bóng), biểu mẫu bên phải. Trên mobile bảng nhận diện thu lại thành thanh.
 */
export function AuthShell({
  step,
  title,
  caption,
  children,
  wide = false,
}: {
  step: string;
  title: string;
  caption?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-full items-center justify-center p-4 sm:p-8">
      <div
        className={`plate rise grid w-full overflow-hidden lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] ${
          wide ? 'max-w-4xl' : 'max-w-3xl'
        }`}
      >
        <IdentityPanel />

        <div className="flex flex-col justify-center p-6 sm:p-10">
          <div className="mb-7">
            <div className="tabular text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
              {step}
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">{title}</h1>
            {caption && <p className="mt-1.5 text-sm text-ink-soft">{caption}</p>}
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}

function IdentityPanel() {
  return (
    <aside className="relative border-b border-rule bg-surface-sunk p-6 sm:p-8 lg:border-b-0 lg:border-r">
      {/* Vạch nhấn dọc, gợi mép thước đo của thiết bị */}
      <div className="absolute inset-y-0 left-0 w-[3px] bg-accent lg:w-1" aria-hidden="true" />

      <div className="flex items-start gap-3">
        <Mark />
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight tracking-tight text-ink">CRM Y Tế</div>
          <div className="tabular text-[10px] uppercase tracking-[0.14em] text-ink-faint">Hệ thống nội bộ</div>
        </div>
      </div>

      <dl className="mt-7 hidden space-y-3.5 lg:block">
        <Spec term="Phiên bản" value="0.1.0 · Phase 1" />
        <Spec term="Mã hoá" value="AES-256-GCM" />
        <Spec term="Xác thực" value="Mật khẩu + TOTP" />
        <Spec term="Tự đăng xuất" value="30 phút không hoạt động" />
      </dl>

      <p className="mt-7 hidden border-t border-rule pt-4 text-[11px] leading-relaxed text-ink-faint lg:block">
        Hệ thống chứa thông tin sức khoẻ được bảo vệ. Mọi lượt truy cập đều được ghi nhật ký bất biến và có thể
        truy vết.
      </p>
    </aside>
  );
}

function Spec({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="field-label">{term}</dt>
      <dd className="tabular mt-0.5 text-[11px] text-ink-soft">{value}</dd>
    </div>
  );
}

/** Dấu hiệu nhận diện: chữ thập y tế dựng từ các nét kẻ, không phải icon bo tròn. */
function Mark() {
  return (
    <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0" aria-hidden="true">
      <rect x="0.5" y="0.5" width="27" height="27" fill="none" stroke="rgb(var(--rule-strong))" />
      <path d="M14 6.5v15M6.5 14h15" stroke="rgb(var(--accent))" strokeWidth="2.5" strokeLinecap="square" />
    </svg>
  );
}
