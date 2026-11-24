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
      <div className="min-w-0">
        {eyebrow && <div className="tabular field-label text-accent">{eyebrow}</div>}
        <h1 className="truncate text-lg font-semibold tracking-tight text-ink">{title}</h1>
        {meta && <p className="tabular mt-0.5 text-xs text-ink-faint">{meta}</p>}
      </div>
      {action}
    </div>
  );
}
