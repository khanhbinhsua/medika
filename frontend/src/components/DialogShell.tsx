import { useEffect } from 'react';
import type { ReactNode } from 'react';

/** Khung hộp thoại dùng chung: nền mờ, khoá cuộn trang, đóng bằng Esc hoặc click ra ngoài. */
export function DialogShell({
  eyebrow,
  title,
  onClose,
  children,
  maxWidth = 'max-w-xl',
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" className={`plate float-3 rise w-full rounded-lg ${maxWidth}`}>
        <div className="flex items-center justify-between border-b border-rule px-5 py-3.5">
          <div>
            <div className="tabular field-label text-accent">{eyebrow}</div>
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded border border-rule-strong px-2 py-1 text-xs text-ink-soft hover:bg-surface-sunk"
          >
            Esc
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
