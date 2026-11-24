import { useEffect, useRef, useState } from 'react';

const LENGTH = 6;

/**
 * Ô nhập mã 6 chữ số. Sáu khung riêng biệt, chữ đều nét — đọc như màn hình
 * thiết bị đo. Hỗ trợ dán cả mã, xoá lùi qua ô trước, và chỉ nhận chữ số.
 *
 * Chuỗi hiện tại được soi qua một ref cập nhật đồng bộ. Nếu tính chuỗi mới từ
 * prop `value` của lần render trước, gõ nhanh sẽ làm mất chữ số: các sự kiện
 * onChange liên tiếp cùng đọc một giá trị cũ trước khi React kịp render lại.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const [digits, setDigits] = useState<string[]>(() => toDigits(value));
  const latest = useRef(digits);

  // Cha có quyền xoá mã (ví dụ sau khi nhập sai) — đồng bộ ngược lại.
  useEffect(() => {
    if (latest.current.join('') === value) return;
    const synced = toDigits(value);
    latest.current = synced;
    setDigits(synced);
  }, [value]);

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  function apply(next: string[]) {
    latest.current = next;
    setDigits(next);
    const joined = next.join('');
    onChange(joined);
    if (joined.length === LENGTH) onComplete?.(joined);
  }

  function writeAt(index: number, digit: string) {
    const next = [...latest.current];
    next[index] = digit;
    apply(next);
  }

  return (
    <div className="flex gap-2" role="group" aria-label={`Mã xác thực ${LENGTH} chữ số`}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            inputs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          aria-label={`Chữ số thứ ${i + 1}`}
          value={d}
          onChange={(e) => {
            const digit = e.target.value.replace(/\D/g, '').slice(-1);
            if (!digit) return;
            writeAt(i, digit);
            inputs.current[Math.min(i + 1, LENGTH - 1)]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              if (latest.current[i]) {
                writeAt(i, '');
              } else if (i > 0) {
                writeAt(i - 1, '');
                inputs.current[i - 1]?.focus();
              }
            }
            if (e.key === 'ArrowLeft' && i > 0) inputs.current[i - 1]?.focus();
            if (e.key === 'ArrowRight' && i < LENGTH - 1) inputs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
            if (!pasted) return;
            apply(toDigits(pasted));
            inputs.current[Math.min(pasted.length, LENGTH - 1)]?.focus();
          }}
          className={[
            'tabular h-14 w-full min-w-0 rounded border bg-surface text-center text-xl font-medium text-ink',
            'transition-colors duration-150',
            invalid ? 'border-danger' : 'border-rule-strong focus:border-accent',
            'disabled:opacity-50',
          ].join(' ')}
        />
      ))}
    </div>
  );
}

function toDigits(v: string): string[] {
  const clean = v.replace(/\D/g, '').slice(0, LENGTH);
  return Array.from({ length: LENGTH }, (_, i) => clean[i] ?? '');
}
