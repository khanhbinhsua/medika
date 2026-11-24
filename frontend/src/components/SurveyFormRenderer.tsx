import type { PublicSurveyQuestion } from '../lib/public-survey';

type SurveyType = 'nps' | 'csat' | 'custom';
export type AnswerMap = Record<string, string | number>;

/** Thang điểm hiệu lực cho câu 'scale' — lấy min/max của câu, mặc định theo loại. */
export function scaleRangeOf(q: PublicSurveyQuestion, type: SurveyType): { min: number; max: number } {
  const def = type === 'csat' ? { min: 1, max: 5 } : { min: 0, max: 10 };
  return { min: q.min ?? def.min, max: q.max ?? def.max };
}

/**
 * Render động các câu hỏi (scale / text / choice) và thu câu trả lời vào một map.
 * Dùng chung cho trang bệnh nhân (tương tác) và màn xem trước của nhân viên
 * (`disabled`). Không tự submit — cha quyết định.
 */
export function SurveyFormRenderer({
  questions,
  type,
  answers,
  onChange,
  disabled = false,
}: {
  questions: PublicSurveyQuestion[];
  type: SurveyType;
  answers: AnswerMap;
  onChange: (id: string, value: string | number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-6">
      {questions.map((q) => (
        <div key={q.id}>
          <div className="text-sm font-medium">
            {q.text}
            {q.required && <span className="text-danger"> *</span>}
          </div>

          {q.type === 'scale' &&
            (() => {
              const { min, max } = scaleRangeOf(q, type);
              const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
              return (
                <div className="mt-2">
                  <div className="flex flex-wrap gap-1.5">
                    {values.map((v) => (
                      <button
                        key={v}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(q.id, v)}
                        className={`tabular h-11 w-11 rounded-lg border text-sm font-semibold transition disabled:cursor-default ${
                          answers[q.id] === v
                            ? 'border-accent bg-accent text-white'
                            : 'border-rule-strong text-ink hover:border-accent hover:text-accent'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  {(q.lowLabel || q.highLabel) && (
                    <div className="mt-1 flex justify-between text-xs text-ink-soft">
                      <span>{q.lowLabel ?? ''}</span>
                      <span>{q.highLabel ?? ''}</span>
                    </div>
                  )}
                </div>
              );
            })()}

          {q.type === 'choice' && (
            <div className="mt-2 space-y-2">
              {(q.options ?? []).map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={q.id}
                    checked={answers[q.id] === opt}
                    disabled={disabled}
                    onChange={() => onChange(q.id, opt)}
                  />
                  {opt}
                </label>
              ))}
            </div>
          )}

          {q.type === 'text' && (
            <textarea
              value={(answers[q.id] as string) ?? ''}
              onChange={(e) => onChange(q.id, e.target.value)}
              disabled={disabled}
              rows={3}
              maxLength={2000}
              placeholder="Nhập câu trả lời…"
              className="mt-2 w-full rounded-lg border border-rule-strong bg-surface px-3 py-2 text-sm text-ink disabled:opacity-70"
            />
          )}
        </div>
      ))}
    </div>
  );
}
