import type { ReactNode } from 'react';

export function PageHeader({
  title,
  meta,
  eyebrow,
  action,
}: {
  title: string;
  meta?: string | undefined;
  eyebrow?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-rule pb-4">
      <div className="flex min-w-0 items-start gap-3">
        {/* Vạch nhấn teal — dấu hiệu "khí cụ", tạo điểm neo thị giác cho tiêu đề */}
        <span className="mt-1 h-7 w-[3px] shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <div className="min-w-0">
          {eyebrow && <div className="tabular field-label text-accent">{eyebrow}</div>}
          <h1 className="truncate text-lg font-semibold tracking-tight text-ink">{title}</h1>
          {meta && <p className="tabular mt-0.5 text-xs text-ink-faint">{meta}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
