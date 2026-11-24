import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMyBranches } from '../lib/branches';
import { useBranchStore } from '../stores/branch.store';
import { useAuthStore } from '../stores/auth.store';

/** Bộ chọn chi nhánh trên topbar (Mốc 0 đa chi nhánh). Ẩn nếu nhân viên chỉ 1 chi nhánh. */
export function BranchSwitcher() {
  const can = useAuthStore((s) => s.can);
  const setBranches = useBranchStore((s) => s.setBranches);
  const select = useBranchStore((s) => s.select);
  const branches = useBranchStore((s) => s.branches);
  const selectedId = useBranchStore((s) => s.selectedId);

  const q = useQuery({
    queryKey: ['my-branches'],
    queryFn: fetchMyBranches,
    enabled: can('branch:read'),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (q.data) setBranches(q.data);
  }, [q.data, setBranches]);

  if (!can('branch:read') || branches.length === 0) return null;

  if (branches.length === 1) {
    return (
      <div className="hidden items-center gap-1.5 border-l border-rule pl-3 text-xs text-ink-soft sm:flex">
        <BranchIcon />
        <span className="font-medium text-ink">{branches[0]!.name}</span>
      </div>
    );
  }

  return (
    <label className="flex items-center gap-1.5 border-l border-rule pl-3">
      <BranchIcon />
      <select
        value={selectedId ?? ''}
        onChange={(e) => select(e.target.value)}
        aria-label="Chọn chi nhánh"
        className="h-8 rounded border border-rule-strong bg-surface px-2 text-xs font-medium text-ink"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function BranchIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 14h12M3 14V6l5-3 5 3v8M6.5 14v-3h3v3" strokeLinejoin="round" />
    </svg>
  );
}
