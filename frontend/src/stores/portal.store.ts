import { create } from 'zustand';
import axios from 'axios';

export interface PortalPatient {
  mrn: string;
  fullName: string;
  dob: string;
  email: string | null;
  phone: string | null;
}

interface PortalState {
  accessToken: string | null;
  patient: PortalPatient | null;
  mustChangePassword: boolean;
  isBootstrapping: boolean;

  login: (email: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refresh: () => Promise<string>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  clear: () => void;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4100/api';

/** Client riêng cho cổng bệnh nhân — cookie/refresh tách khỏi phía nhân viên. */
const portalApi = axios.create({ baseURL: API_BASE, withCredentials: true, timeout: 15_000 });

interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  mustChangePassword: boolean;
  patient: PortalPatient;
}

let refreshInFlight: Promise<string> | null = null;

/**
 * Store cổng bệnh nhân — HOÀN TOÀN tách biệt với auth.store (nhân viên). Token
 * dùng audience khác, cookie refresh khác path. Không dùng chung state để tránh
 * lẫn phiên nhân viên và phiên bệnh nhân.
 */
export const usePortalStore = create<PortalState>((set, get) => ({
  accessToken: null,
  patient: null,
  mustChangePassword: false,
  isBootstrapping: true,

  login: async (email, password) => {
    const { data } = await portalApi.post<AuthResponse>('/portal/auth/login', { email, password });
    set({ accessToken: data.accessToken, patient: data.patient, mustChangePassword: data.mustChangePassword });
  },

  changePassword: async (currentPassword, newPassword) => {
    const token = get().accessToken;
    await portalApi.post(
      '/portal/auth/change-password',
      { currentPassword, newPassword },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    // Đổi mật khẩu thu hồi mọi phiên — buộc đăng nhập lại.
    set({ accessToken: null, patient: null, mustChangePassword: false });
  },

  refresh: async () => {
    refreshInFlight ??= (async () => {
      const { data } = await portalApi.post<AuthResponse>('/portal/auth/refresh', {});
      set({ accessToken: data.accessToken, patient: data.patient, mustChangePassword: data.mustChangePassword });
      return data.accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  },

  logout: async () => {
    const token = get().accessToken;
    try {
      if (token) await portalApi.post('/portal/auth/logout', {}, { headers: { Authorization: `Bearer ${token}` } });
    } finally {
      set({ accessToken: null, patient: null, mustChangePassword: false });
    }
  },

  bootstrap: async () => {
    try {
      await get().refresh();
    } catch {
      set({ accessToken: null, patient: null });
    } finally {
      set({ isBootstrapping: false });
    }
  },

  clear: () => set({ accessToken: null, patient: null, mustChangePassword: false }),
}));

/** Axios client dùng cho các lời gọi dữ liệu cổng (tự gắn token + refresh khi 401). */
export const portalClient = axios.create({ baseURL: API_BASE, withCredentials: true, timeout: 15_000 });

portalClient.interceptors.request.use((config) => {
  const token = usePortalStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

portalClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
    if (error.response?.status !== 401 || !original || original._retried) return Promise.reject(error);
    original._retried = true;
    try {
      const token = await usePortalStore.getState().refresh();
      original.headers = original.headers ?? {};
      original.headers.Authorization = `Bearer ${token}`;
      return portalClient(original);
    } catch {
      usePortalStore.getState().clear();
      window.location.href = '/portal/login';
      return Promise.reject(error);
    }
  },
);
