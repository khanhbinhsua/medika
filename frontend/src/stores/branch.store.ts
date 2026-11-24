import { create } from 'zustand';
import type { Branch } from '../lib/branches';

const LS_KEY = 'crmdk.selectedBranchId';

function readSaved(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}
function writeSaved(id: string | null) {
  try {
    if (id) localStorage.setItem(LS_KEY, id);
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* private mode / blocked — bỏ qua, chỉ là tiện ích per-viewer */
  }
}

interface BranchState {
  branches: Branch[];
  selectedId: string | null;
  loaded: boolean;
  setBranches: (branches: Branch[]) => void;
  select: (id: string) => void;
  reset: () => void;
}

export const useBranchStore = create<BranchState>((set, get) => ({
  branches: [],
  selectedId: readSaved(),
  loaded: false,
  setBranches: (branches) => {
    // Giữ lựa chọn đã lưu nếu còn hợp lệ; nếu không, lấy chi nhánh mặc định hoặc cái đầu.
    const saved = get().selectedId;
    const valid = branches.find((b) => b.id === saved);
    const fallback = branches.find((b) => b.isDefault) ?? branches[0];
    const selectedId = valid ? saved : (fallback?.id ?? null);
    if (selectedId !== saved) writeSaved(selectedId);
    set({ branches, selectedId, loaded: true });
  },
  select: (id) => {
    writeSaved(id);
    set({ selectedId: id });
  },
  reset: () => {
    writeSaved(null);
    set({ branches: [], selectedId: null, loaded: false });
  },
}));
