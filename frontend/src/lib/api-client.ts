import axios, { AxiosError } from 'axios';
import { useAuthStore } from '../stores/auth.store';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4100/api',
  withCredentials: true, // refresh token đi qua httpOnly cookie
  timeout: 15_000,
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined;

    if (error.response?.status !== 401 || !original || original._retried) {
      return Promise.reject(error);
    }

    original._retried = true;

    try {
      // Store đã gộp các lời gọi đồng thời, nên nhiều request cùng nhận 401
      // vẫn chỉ tạo ra một lần refresh (token bị xoay mỗi lần dùng).
      const token = await useAuthStore.getState().refresh();
      original.headers = original.headers ?? {};
      original.headers.Authorization = `Bearer ${token}`;
      return apiClient(original);
    } catch {
      useAuthStore.getState().clear();
      window.location.href = '/login';
      return Promise.reject(error);
    }
  },
);

export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string };
}

export function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError<ApiErrorBody>(err)) {
    return err.response?.data?.error?.message ?? 'Không kết nối được máy chủ';
  }
  return 'Đã xảy ra lỗi không xác định';
}
