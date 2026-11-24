import axios from 'axios';

// Instance RIÊNG, KHÔNG interceptor auth — trang khảo sát công khai không có
// phiên đăng nhập, không được redirect về /login khi gặp lỗi.
const publicApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4100/api',
  timeout: 15_000,
});

export interface PublicSurveyQuestion {
  id: string;
  text: string;
  type: 'scale' | 'text' | 'choice';
  required?: boolean;
  min?: number;
  max?: number;
  lowLabel?: string;
  highLabel?: string;
  primary?: boolean;
  options?: string[];
}

export interface PublicSurveyView {
  surveyName: string;
  type: 'nps' | 'csat' | 'custom';
  questions: PublicSurveyQuestion[];
  alreadyResponded: boolean;
}

export async function getPublicSurvey(token: string): Promise<PublicSurveyView> {
  const { data } = await publicApi.get<PublicSurveyView>(`/public/surveys/${token}`);
  return data;
}

export async function submitPublicSurvey(
  token: string,
  input: { score?: number; comment?: string; answers?: Record<string, string | number> },
): Promise<{ recorded: true; isNegative: boolean }> {
  const { data } = await publicApi.post(`/public/surveys/${token}`, input);
  return data;
}

export function publicSurveyError(err: unknown): { status: number; message: string } {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status ?? 0;
    const message =
      (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message ??
      'Không kết nối được máy chủ';
    return { status, message };
  }
  return { status: 0, message: 'Đã xảy ra lỗi không xác định' };
}
