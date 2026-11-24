import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchIcd10, type Icd10Item } from '../lib/icd10';
import { Input } from './ui';

interface Props {
  value: string;
  onChange: (code: string) => void;
  /** Gọi khi chọn một gợi ý — cha có thể tự điền tên bệnh nếu đang trống. */
  onPick?: (item: Icd10Item) => void;
  placeholder?: string;
}

/** Ô nhập ICD-10 có tìm kiếm + gợi ý (theo mã hoặc tên bệnh, không phân biệt dấu). */
export function Icd10Combobox({ value, onChange, onPick, placeholder = 'Gõ mã hoặc tên bệnh' }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [debounced, setDebounced] = useState(value);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounce 200ms để không gọi API mỗi phím.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 200);
    return () => clearTimeout(t);
  }, [value]);

  const q = useQuery({
    queryKey: ['icd10', debounced],
    queryFn: () => searchIcd10(debounced),
    enabled: open && debounced.trim().length >= 1,
    staleTime: 60_000,
  });
  const results = q.data ?? [];

  // Đóng khi click ra ngoài.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(item: Icd10Item) {
    onChange(item.code);
    onPick?.(item);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = results[active]; if (it) pick(it); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="tabular"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
      />
      {open && debounced.trim().length >= 1 && (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded border border-rule-strong bg-surface shadow-lg">
          {q.isLoading ? (
            <div className="px-3 py-2 text-xs text-ink-soft">Đang tìm…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-soft">Không có mã phù hợp — có thể tự nhập mã.</div>
          ) : (
            <ul role="listbox">
              {results.map((it, i) => (
                <li key={it.code}>
                  <button
                    type="button"
                    // onMouseDown (không phải onClick) để chọn trước khi input mất focus.
                    onMouseDown={(e) => { e.preventDefault(); pick(it); }}
                    onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                      i === active ? 'bg-surface-sunk' : ''
                    } hover:bg-surface-sunk`}
                  >
                    <span className="tabular shrink-0 font-medium text-accent">{it.code}</span>
                    <span className="truncate text-ink-soft">{it.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
