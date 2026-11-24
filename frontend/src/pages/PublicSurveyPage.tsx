import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getPublicSurvey, submitPublicSurvey, publicSurveyError } from '../lib/public-survey';
import type { PublicSurveyView } from '../lib/public-survey';
import { SurveyFormRenderer, type AnswerMap } from '../components/SurveyFormRenderer';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-surface-sunk p-4">
      <div className="plate w-full max-w-lg p-6 sm:p-8">{children}</div>
    </div>
  );
}

export function PublicSurveyPage() {
  const { token = '' } = useParams();
  const survey = useQuery({
    queryKey: ['public-survey', token],
    queryFn: () => getPublicSurvey(token),
    retry: false,
  });

  if (survey.isLoading) {
    return (
      <Shell>
        <div className="text-center text-sm text-ink-soft">Đang tải khảo sát…</div>
      </Shell>
    );
  }

  if (survey.isError) {
    const e = publicSurveyError(survey.error);
    const msg =
      e.status === 404
        ? 'Liên kết khảo sát không hợp lệ hoặc đã hết hạn.'
        : e.status === 409
          ? 'Khảo sát này đã đóng. Cảm ơn bạn đã quan tâm.'
          : e.message;
    return (
      <Shell>
        <h1 className="text-lg font-semibold tracking-tight">Không mở được khảo sát</h1>
        <p className="mt-2 text-sm text-ink-soft">{msg}</p>
      </Shell>
    );
  }

  if (survey.data?.alreadyResponded) {
    return (
      <Shell>
        <div className="text-center">
          <div className="text-3xl">✓</div>
          <h1 className="mt-2 text-lg font-semibold tracking-tight">Bạn đã gửi phản hồi</h1>
          <p className="mt-2 text-sm text-ink-soft">Cảm ơn bạn đã đánh giá dịch vụ của phòng khám.</p>
        </div>
      </Shell>
    );
  }

  return <SurveyForm token={token} view={survey.data!} />;
}

function SurveyForm({ token, view }: { token: string; view: PublicSurveyView }) {
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ isNegative: boolean } | null>(null);

  const setAnswer = (id: string, value: string | number) => setAnswers((prev) => ({ ...prev, [id]: value }));

  const missingRequired = view.questions.filter((q) => {
    const a = answers[q.id];
    return q.required && (a === undefined || a === '' || a === null);
  });

  const mutation = useMutation({
    mutationFn: () => submitPublicSurvey(token, { answers }),
    onSuccess: (r) => setDone({ isNegative: r.isNegative }),
    onError: (err) => setError(publicSurveyError(err).message),
  });

  if (done) {
    return (
      <Shell>
        <div className="text-center">
          <div className="text-3xl">🙏</div>
          <h1 className="mt-2 text-lg font-semibold tracking-tight">Cảm ơn bạn!</h1>
          <p className="mt-2 text-sm text-ink-soft">
            {done.isNegative
              ? 'Chúng tôi rất tiếc vì trải nghiệm chưa tốt. Phòng khám sẽ xem xét phản hồi của bạn và liên hệ nếu cần.'
              : 'Phản hồi của bạn đã được ghi nhận và giúp phòng khám phục vụ tốt hơn.'}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="tabular text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">Khảo sát</div>
      <h1 className="mt-1 text-lg font-semibold tracking-tight">{view.surveyName}</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (missingRequired.length > 0) {
            setError(`Vui lòng trả lời: ${missingRequired.map((q) => q.text).join(', ')}`);
            return;
          }
          mutation.mutate();
        }}
        className="mt-6 space-y-6"
      >
        {error && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
        )}

        <SurveyFormRenderer questions={view.questions} type={view.type} answers={answers} onChange={setAnswer} />

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-lg bg-accent py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {mutation.isPending ? 'Đang gửi…' : 'Gửi phản hồi'}
        </button>
        <p className="text-center text-xs text-ink-soft">Phản hồi của bạn được bảo mật theo quy định.</p>
      </form>
    </Shell>
  );
}
