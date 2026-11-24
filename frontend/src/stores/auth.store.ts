import { create } from 'zustand';
import axios from 'axios';

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  permissions: string[];
}

export type LoginOutcome =
  | { kind: 'authenticated' }
  | { kind: 'mfa_required'; mfaToken: string }
  | { kind: 'mfa_enrollment_required'; enrollmentToken: string };

interface AuthState {
  accessToken: string | null;
  user: CurrentUser | null;
  isBootstrapping: boolean;

  login: (email: string, password: string) => Promise<LoginOutcome>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  verifyRecoveryCode: (mfaToken: string, recoveryCode: string) => Promise<void>;
  startEnrollment: (enrollmentToken: string) => Promise<{ otpauthUrl: string; recoveryCodes: string[] }>;
  confirmEnrollment: (enrollmentToken: string, code: string) => Promise<void>;
  refresh: () => Promise<string>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  clear: () => void;
  can: (permission: string) => boolean;
}

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4100/api';

/** Client riêng cho auth: không đi qua interceptor refresh, tránh vòng lặp vô hạn. */
const authApi = axios.create({ baseURL: API_BASE, withCredentials: true, timeout: 15_000 });

interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: CurrentUser;
}

/** Refresh đang chạy dở, dùng chung cho mọi lời gọi đồng thời. */
let refreshInFlight: Promise<string> | null = null;

/**
 * Access token chỉ nằm trong bộ nhớ, KHÔNG localStorage — XSS không đọc được,
 * và token biến mất khi đóng tab. Refresh token nằm trong cookie httpOnly.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  isBootstrapping: true,

  login: async (email, password) => {
    const { data } = await authApi.post<
      AuthResponse | { mfaRequired: true; mfaToken: string } | { mfaEnrollmentRequired: true; enrollmentToken: string }
    >('/auth/login', { email, password });

    if ('mfaRequired' in data) return { kind: 'mfa_required', mfaToken: data.mfaToken };
    if ('mfaEnrollmentRequired' in data) {
      return { kind: 'mfa_enrollment_required', enrollmentToken: data.enrollmentToken };
    }

    set({ accessToken: data.accessToken, user: data.user });
    return { kind: 'authenticated' };
  },

  verifyMfa: async (mfaToken, code) => {
    const { data } = await authApi.post<AuthResponse>('/auth/mfa/verify', { mfaToken, code });
    set({ accessToken: data.accessToken, user: data.user });
  },

  verifyRecoveryCode: async (mfaToken, recoveryCode) => {
    const { data } = await authApi.post<AuthResponse>('/auth/mfa/recovery', { mfaToken, recoveryCode });
    set({ accessToken: data.accessToken, user: data.user });
  },

  startEnrollment: async (enrollmentToken) => {
    const { data } = await authApi.post<{ otpauthUrl: string; recoveryCodes: string[] }>(
      '/auth/mfa/enroll/start',
      { enrollmentToken },
    );
    return data;
  },

  confirmEnrollment: async (enrollmentToken, code) => {
    const { data } = await authApi.post<AuthResponse>('/auth/mfa/enroll/confirm', { enrollmentToken, code });
    set({ accessToken: data.accessToken, user: data.user });
  },

  /**
   * Gộp mọi lời gọi đồng thời vào một request duy nhất (single-flight).
   * Server xoay refresh token mỗi lần dùng, nên hai request song song sẽ khiến
   * request thứ hai cầm token đã bị vô hiệu và nhận 401 — người dùng bị đá ra
   * dù phiên vẫn hợp lệ. Kịch bản gặp thật khi mở nhiều tab, khi vài request
   * cùng nhận 401, và khi React StrictMode gọi effect hai lần ở môi trường dev.
   */
  refresh: async () => {
    refreshInFlight ??= (async () => {
      const { data } = await authApi.post<AuthResponse>('/auth/refresh', {});
      set({ accessToken: data.accessToken, user: data.user });
      return data.accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });

    return refreshInFlight;
  },

  logout: async () => {
    const token = get().accessToken;
    try {
      if (token) {
        await authApi.post('/auth/logout', {}, { headers: { Authorization: `Bearer ${token}` } });
      }
    } finally {
      set({ accessToken: null, user: null });
    }
  },

  bootstrap: async () => {
    try {
      await get().refresh();
    } catch {
      set({ accessToken: null, user: null });
    } finally {
      set({ isBootstrapping: false });
    }
  },

  clear: () => set({ accessToken: null, user: null }),

  can: (permission) => get().user?.permissions.includes(permission) ?? false,
}));

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Quản trị viên',
  doctor: 'Bác sĩ',
  nurse: 'Y tá',
  receptionist: 'Lễ tân',
  auditor: 'Kiểm toán viên',
};
