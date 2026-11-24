import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ── Button ────────────────────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
  loading?: boolean;
};

export function Button({ variant = 'primary', loading, className, children, disabled, ...rest }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded px-4 h-10 text-sm font-medium ' +
    'transition-[background-color,border-color,color] duration-150 ' +
    'disabled:cursor-not-allowed disabled:opacity-45';

  const variants = {
    primary: 'bg-accent text-white hover:bg-accent-deep border border-transparent',
    ghost: 'border border-rule-strong text-ink hover:bg-surface-sunk',
    danger: 'border border-danger/40 text-danger hover:bg-danger-wash',
  };

  return (
    <button className={cx(base, variants[variant], className)} disabled={disabled || loading} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ── Field + Input ─────────────────────────────────────────────────────

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx(
        'h-10 w-full rounded border bg-surface px-3 text-sm text-ink placeholder:text-ink-faint',
        'transition-colors duration-150',
        invalid ? 'border-danger' : 'border-rule-strong hover:border-ink-faint',
        className,
      )}
      {...rest}
    />
  );
});

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="mt-1.5 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-ink-faint">{hint}</p>
      ) : null}
    </label>
  );
}

// ── Alert ─────────────────────────────────────────────────────────────

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'warn' | 'ok'; children: ReactNode }) {
  const tones = {
    danger: 'border-danger/35 bg-danger-wash text-danger',
    warn: 'border-warn/35 bg-warn-wash text-warn',
    ok: 'border-ok/35 bg-ok-wash text-ok',
  };
  return (
    <div role="alert" className={cx('rounded border px-3 py-2.5 text-sm', tones[tone])}>
      {children}
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'accent' | 'danger' | 'warn' | 'ok'; children: ReactNode }) {
  const tones = {
    neutral: 'border-rule-strong text-ink-soft',
    accent: 'border-accent/40 bg-accent-wash text-accent-deep',
    danger: 'border-danger/40 bg-danger-wash text-danger',
    warn: 'border-warn/40 bg-warn-wash text-warn',
    ok: 'border-ok/40 bg-ok-wash text-ok',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

// ── Data plate: nhãn kiểu tem mẫu bệnh phẩm ───────────────────────────

export function DataPlate({ label, value, mono = true }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="field-label">{label}</div>
      <div className={cx('mt-0.5 truncate text-sm text-ink', mono && 'tabular')}>{value || '—'}</div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded bg-surface-sunk', className)} />;
}
