import type { ReactNode } from 'react';

/**
 * Khung cho màn hình xác thực cổng bệnh nhân. Nhận diện riêng, dịu hơn giao
 * diện nhân viên (bệnh nhân, không phải công cụ lâm sàng) nhưng vẫn cùng hệ
 * thiết kế — viền kẻ tóc, màu nhấn teal y tế.
 */
export function PortalShell({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4 sm:p-8">
      <div className="plate rise w-full max-w-md overflow-hidden">
        <div className="border-b border-rule bg-surface-sunk p-6">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0" aria-hidden="true">
              <rect x="0.5" y="0.5" width="27" height="27" rx="4" fill="none" stroke="rgb(var(--rule-strong))" />
              <path d="M14 6.5v15M6.5 14h15" stroke="rgb(var(--accent))" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <div>
              <div className="text-sm font-semibold leading-tight tracking-tight text-ink">CRM Y Tế</div>
              <div className="tabular text-[10px] uppercase tracking-[0.14em] text-ink-faint">Cổng bệnh nhân</div>
            </div>
          </div>
        </div>
        <div className="p-6 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {caption && <p className="mt-1.5 text-sm text-ink-soft">{caption}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
