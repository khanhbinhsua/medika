import crypto from 'node:crypto';
import { db } from '../../db/index.js';
import type { SurveyType, SurveyStatus, SurveyQuestion } from '../../db/types.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { writeAuditLog } from '../../audit/audit-logger.js';
import { NotFoundError, ConflictError, ValidationError, DataDestroyedError } from '../../middleware/errors.js';
import { loadDek } from '../../crypto/dek-store.js';
import { encryptField, encryptOptionalField, decryptOptionalField, searchHash, zeroize } from '../../crypto/field-encryption.js';
import { sendNotification } from '../notification/notification.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import type { CreateSurveyInput, RespondInput } from './survey.schemas.js';

// ── Câu hỏi mặc định cho NPS / CSAT ─────────────────────────────────────────

function defaultQuestions(type: SurveyType): SurveyQuestion[] {
  if (type === 'nps') {
    return [
      {
        id: 'nps',
        text: 'Bạn có sẵn lòng giới thiệu phòng khám cho người thân?',
        type: 'scale',
        min: 0,
        max: 10,
        lowLabel: 'Rất khó',
        highLabel: 'Chắc chắn giới thiệu',
        primary: true,
        required: true,
        negativeAtOrBelow: 6,
      },
      { id: 'comment', text: 'Góp ý thêm (không bắt buộc)', type: 'text' },
    ];
  }
  if (type === 'csat') {
    return [
      {
        id: 'csat',
        text: 'Bạn hài lòng thế nào với lần khám này?',
        type: 'scale',
        min: 1,
        max: 5,
        lowLabel: 'Rất không hài lòng',
        highLabel: 'Rất hài lòng',
        primary: true,
        required: true,
        negativeAtOrBelow: 2,
      },
      { id: 'comment', text: 'Góp ý thêm (không bắt buộc)', type: 'text' },
    ];
  }
  return [];
}

// Thang điểm mặc định theo loại (dùng khi câu hỏi cũ chưa có min/max tường minh).
function typeScaleDefault(type: SurveyType): { min: number; max: number; negativeAtOrBelow?: number } | null {
  if (type === 'nps') return { min: 0, max: 10, negativeAtOrBelow: 6 };
  if (type === 'csat') return { min: 1, max: 5, negativeAtOrBelow: 2 };
  return null;
}

/** Câu điểm chính = câu 'scale' đánh dấu primary, hoặc câu scale đầu tiên. */
function primaryScaleQuestion(questions: SurveyQuestion[]): SurveyQuestion | null {
  const scales = questions.filter((q) => q.type === 'scale');
  return scales.find((q) => q.primary) ?? scales[0] ?? null;
}

function scaleBounds(q: SurveyQuestion, type: SurveyType): { min: number; max: number; negativeAtOrBelow?: number | undefined } {
  const def = typeScaleDefault(type);
  return {
    min: q.min ?? def?.min ?? 0,
    max: q.max ?? def?.max ?? 10,
    negativeAtOrBelow: q.negativeAtOrBelow ?? def?.negativeAtOrBelow,
  };
}

// ── Survey CRUD ─────────────────────────────────────────────────────────────

export interface SurveyDto {
  id: string;
  name: string;
  type: SurveyType;
  questions: SurveyQuestion[];
  status: SurveyStatus;
  createdAt: Date;
}

function toSurveyDto(r: {
  id: string;
  name: string;
  type: SurveyType;
  questions: SurveyQuestion[];
  status: SurveyStatus;
  created_at: Date;
}): SurveyDto {
  return { id: r.id, name: r.name, type: r.type, questions: r.questions, status: r.status, createdAt: r.created_at };
}

export async function createSurvey(input: CreateSurveyInput, actor: Actor, meta: RequestMeta): Promise<SurveyDto> {
  const questions = input.questions && input.questions.length > 0 ? input.questions : defaultQuestions(input.type);
  if (questions.length === 0) throw new ValidationError('Khảo sát tuỳ chỉnh cần ít nhất một câu hỏi');

  const row = await db
    .insertInto('surveys')
    .values({ name: input.name, type: input.type, questions: JSON.stringify(questions), created_by: actor.id })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db.transaction().execute((trx) =>
    writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'SURVEY_CREATE',
      entityType: 'survey',
      entityId: row.id,
      reason: `type=${input.type}`,
      ipAddress: meta.ipAddress,
    }),
  );
  return toSurveyDto(row);
}

export async function listSurveys(): Promise<SurveyDto[]> {
  const rows = await db.selectFrom('surveys').selectAll().orderBy('created_at', 'desc').execute();
  return rows.map(toSurveyDto);
}

export async function getSurvey(id: string): Promise<SurveyDto> {
  const row = await db.selectFrom('surveys').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw new NotFoundError('Khảo sát');
  return toSurveyDto(row);
}

export async function updateSurvey(
  id: string,
  input: { name?: string | undefined; questions?: SurveyQuestion[] | undefined; status?: SurveyStatus | undefined },
): Promise<SurveyDto> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.questions !== undefined) patch.questions = JSON.stringify(input.questions);
  if (input.status !== undefined) patch.status = input.status;
  if (Object.keys(patch).length === 0) patch.updated_at = new Date();
  const row = await db.updateTable('surveys').set(patch).where('id', '=', id).returningAll().executeTakeFirst();
  if (!row) throw new NotFoundError('Khảo sát');
  return toSurveyDto(row);
}

// ── Gửi lời mời khảo sát ─────────────────────────────────────────────────────

async function loadActiveSurvey(surveyId: string) {
  const survey = await db.selectFrom('surveys').selectAll().where('id', '=', surveyId).executeTakeFirst();
  if (!survey) throw new NotFoundError('Khảo sát');
  if (survey.status !== 'active') throw new ConflictError('Khảo sát chưa ở trạng thái active');
  return survey;
}

/**
 * Tạo lời mời + gửi link đa kênh (Module 8). Trả về invitationId + đã gửi hay chưa.
 * Idempotent theo (survey, appointment): mời lại cùng lịch hẹn sẽ bị chặn.
 */
export async function sendInvite(
  surveyId: string,
  input: { patientId: string; appointmentId?: string | undefined; doctorId?: string | undefined },
  actor: Actor,
  meta: RequestMeta,
): Promise<{ invitationId: string; status: string }> {
  await loadActiveSurvey(surveyId);
  const patient = await db
    .selectFrom('patients')
    .select('id')
    .where('id', '=', input.patientId)
    .where('deleted_at', 'is', null)
    .where('purged_at', 'is', null)
    .executeTakeFirst();
  if (!patient) throw new NotFoundError('Bệnh nhân');

  const { invitationId, token } = await createInvitation(surveyId, input);
  const status = await deliverInvite(surveyId, invitationId, input.patientId, token);

  await db.transaction().execute((trx) =>
    writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'SURVEY_INVITE_SEND',
      entityType: 'survey',
      entityId: surveyId,
      reason: `status=${status}`,
      ipAddress: meta.ipAddress,
    }),
  );
  return { invitationId, status };
}

async function createInvitation(
  surveyId: string,
  input: { patientId: string; appointmentId?: string | undefined; doctorId?: string | undefined },
): Promise<{ invitationId: string; token: string }> {
  const token = crypto.randomBytes(32).toString('base64url');
  try {
    const row = await db
      .insertInto('survey_invitations')
      .values({
        survey_id: surveyId,
        patient_id: input.patientId,
        appointment_id: input.appointmentId ?? null,
        doctor_id: input.doctorId ?? null,
        token_hash: searchHash(token),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { invitationId: row.id, token };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError('Lịch hẹn này đã được mời khảo sát');
    }
    throw err;
  }
}

/** Gửi link khảo sát qua Module 8, cập nhật trạng thái lời mời. */
async function deliverInvite(surveyId: string, invitationId: string, patientId: string, token: string): Promise<string> {
  const link = `${env.SURVEY_PUBLIC_BASE_URL}/survey/${token}`;
  const result = await sendNotification({
    patientId,
    kind: 'survey',
    vars: { noi_dung: `Mời bạn đánh giá chất lượng dịch vụ: ${link}` },
    relatedType: 'survey',
    relatedId: surveyId,
  });
  const ok = result.status === 'sent';
  await db
    .updateTable('survey_invitations')
    .set({
      status: ok ? 'sent' : 'failed',
      notification_id: result.id,
      sent_at: ok ? new Date() : null,
    })
    .where('id', '=', invitationId)
    .execute();
  return ok ? 'sent' : 'failed';
}

/**
 * Gửi khảo sát TỰ ĐỘNG cho các lịch hẹn 'completed' trong sinceHours giờ gần đây
 * mà chưa được mời khảo sát này. Idempotent (ràng buộc unique + lọc NOT EXISTS).
 */
export async function dispatchAuto(
  surveyId: string,
  sinceHours: number,
  actor: Actor,
  meta: RequestMeta,
): Promise<{ candidates: number; sent: number; failed: number }> {
  await loadActiveSurvey(surveyId);
  const since = new Date(Date.now() - sinceHours * 3600_000);

  const appts = await db
    .selectFrom('appointments as a')
    .innerJoin('patients as p', 'p.id', 'a.patient_id')
    .select(['a.id as appointment_id', 'a.patient_id', 'a.doctor_id'])
    .where('a.status', '=', 'completed')
    .where('a.completed_at', '>=', since)
    .where('p.deleted_at', 'is', null)
    .where('p.purged_at', 'is', null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('survey_invitations as si')
            .select('si.id')
            .where('si.survey_id', '=', surveyId)
            .where('si.appointment_id', '=', eb.ref('a.id')),
        ),
      ),
    )
    .execute();

  let sent = 0;
  let failed = 0;
  for (const a of appts) {
    try {
      const { invitationId, token } = await createInvitation(surveyId, {
        patientId: a.patient_id,
        appointmentId: a.appointment_id,
        doctorId: a.doctor_id ?? undefined,
      });
      const status = await deliverInvite(surveyId, invitationId, a.patient_id, token);
      if (status === 'sent') sent++;
      else failed++;
    } catch (err) {
      // Chạy song song có thể chèn trùng — bỏ qua, không tính là lỗi gửi.
      if (!(err instanceof ConflictError)) throw err;
    }
  }

  await db.transaction().execute((trx) =>
    writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'SURVEY_DISPATCH_AUTO',
      entityType: 'survey',
      entityId: surveyId,
      reason: `candidates=${appts.length} sent=${sent} failed=${failed}`,
      ipAddress: meta.ipAddress,
    }),
  );
  return { candidates: appts.length, sent, failed };
}

// ── Trả lời khảo sát qua link công khai (KHÔNG đăng nhập) ────────────────────

export interface PublicSurveyView {
  surveyName: string;
  type: SurveyType;
  questions: SurveyQuestion[];
  alreadyResponded: boolean;
}

/** Xem khảo sát để render form. Chỉ trả cấu trúc câu hỏi (không PHI). */
export async function getPublicByToken(token: string): Promise<PublicSurveyView> {
  const inv = await db
    .selectFrom('survey_invitations as si')
    .innerJoin('surveys as s', 's.id', 'si.survey_id')
    .select(['si.status', 's.name', 's.type', 's.questions', 's.status as survey_status'])
    .where('si.token_hash', '=', searchHash(token))
    .executeTakeFirst();
  if (!inv) throw new NotFoundError('Lời mời khảo sát');
  if (inv.survey_status === 'closed') throw new ConflictError('Khảo sát đã đóng');
  return {
    surveyName: inv.name,
    type: inv.type,
    questions: inv.questions,
    alreadyResponded: inv.status === 'responded',
  };
}

/**
 * Nhận phản hồi từ link công khai. Câu trả lời chi tiết + góp ý được MÃ HOÁ bằng
 * DEK của bệnh nhân (dù nộp qua kênh công khai, server có quyền dùng KEK). Điểm
 * số lưu plaintext để tổng hợp. Chấm cờ tiêu cực + ghi cảnh báo nếu điểm thấp.
 * Một lời mời chỉ trả lời một lần.
 */
export async function submitResponse(token: string, input: RespondInput, meta: RequestMeta): Promise<{ recorded: true; isNegative: boolean }> {
  const inv = await db
    .selectFrom('survey_invitations as si')
    .innerJoin('surveys as s', 's.id', 'si.survey_id')
    .innerJoin('patients as p', 'p.id', 'si.patient_id')
    .select([
      'si.id as invitation_id',
      'si.survey_id',
      'si.patient_id',
      'si.appointment_id',
      'si.doctor_id',
      'si.status as invite_status',
      's.type',
      's.questions',
      's.status as survey_status',
      'p.dek_id',
      'p.purged_at',
    ])
    .where('si.token_hash', '=', searchHash(token))
    .executeTakeFirst();
  if (!inv) throw new NotFoundError('Lời mời khảo sát');
  if (inv.survey_status === 'closed') throw new ConflictError('Khảo sát đã đóng');
  if (inv.invite_status === 'responded') throw new ConflictError('Bạn đã gửi phản hồi cho khảo sát này');
  if (inv.purged_at) throw new DataDestroyedError('Dữ liệu bệnh nhân đã bị tiêu huỷ');

  // Gộp câu trả lời: ưu tiên `answers` (nhiều câu); tương thích ngược với
  // `score`/`comment` cũ bằng cách map vào câu điểm chính / câu text đầu tiên.
  const questions: SurveyQuestion[] = inv.questions;
  const answers: Record<string, string | number> = { ...(input.answers ?? {}) };
  const primary = primaryScaleQuestion(questions);
  if (Object.keys(answers).length === 0) {
    if (input.score !== undefined && primary) answers[primary.id] = input.score;
    const firstText = questions.find((q) => q.type === 'text');
    if (input.comment && firstText) answers[firstText.id] = input.comment;
  }

  const isAnswered = (v: unknown) => v !== undefined && v !== null && v !== '';
  // Kiểm từng câu: bắt buộc phải trả lời, scale trong thang, choice thuộc phương án.
  for (const q of questions) {
    const a = answers[q.id];
    if (!isAnswered(a)) {
      if (q.required) throw new ValidationError(`Vui lòng trả lời: ${q.text}`);
      continue;
    }
    if (q.type === 'scale') {
      const b = scaleBounds(q, inv.type);
      const n = Number(a);
      if (!Number.isInteger(n) || n < b.min || n > b.max) {
        throw new ValidationError(`Điểm cho "${q.text}" phải trong khoảng ${b.min}–${b.max}`);
      }
    }
    if (q.type === 'choice' && q.options && !q.options.includes(String(a))) {
      throw new ValidationError(`Lựa chọn không hợp lệ cho: ${q.text}`);
    }
  }

  // Điểm chính (đưa vào báo cáo) + cờ tiêu cực từ ngưỡng của câu điểm chính.
  let score: number | null = null;
  let isNegative = false;
  if (primary && isAnswered(answers[primary.id])) {
    score = Number(answers[primary.id]);
    const b = scaleBounds(primary, inv.type);
    if (b.negativeAtOrBelow !== undefined) isNegative = score <= b.negativeAtOrBelow;
  } else if ((inv.type === 'nps' || inv.type === 'csat') && primary) {
    throw new ValidationError('Vui lòng chọn điểm đánh giá');
  }

  // Góp ý = gộp mọi câu trả lời dạng text (cho danh sách phản hồi tiêu cực).
  const commentText =
    questions
      .filter((q) => q.type === 'text' && isAnswered(answers[q.id]))
      .map((q) => String(answers[q.id]))
      .join(' | ') || null;

  const dek = await loadDek(db, inv.dek_id);
  let answersEnc: Buffer | null;
  let commentEnc: Buffer | null;
  try {
    answersEnc = Object.keys(answers).length ? encryptField(JSON.stringify(answers), dek) : null;
    commentEnc = encryptOptionalField(commentText, dek);
  } finally {
    zeroize(dek);
  }

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('survey_responses')
      .values({
        survey_id: inv.survey_id,
        invitation_id: inv.invitation_id,
        patient_id: inv.patient_id,
        appointment_id: inv.appointment_id,
        doctor_id: inv.doctor_id,
        score,
        answers_enc: answersEnc,
        comment_enc: commentEnc,
        is_negative: isNegative,
      })
      .execute();
    await trx
      .updateTable('survey_invitations')
      .set({ status: 'responded', responded_at: new Date() })
      .where('id', '=', inv.invitation_id)
      .execute();

    // Bệnh nhân nộp qua link công khai (không phải user hệ thống) — ghi audit_log
    // (actor = 'patient:survey'), KHÔNG ghi phi_access_log (dành cho nhân viên truy
    // cập PHI; accessed_by tham chiếu users). Phản hồi tiêu cực → hành động cảnh báo.
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorEmail: 'patient:survey',
      action: isNegative ? 'SURVEY_NEGATIVE_ALERT' : 'SURVEY_RESPONSE_SUBMIT',
      entityType: 'survey',
      entityId: inv.survey_id,
      reason: `score=${score ?? '-'}`,
      ipAddress: meta.ipAddress,
    });
  });

  if (isNegative) logger.warn({ surveyId: inv.survey_id, score }, 'Phản hồi khảo sát tiêu cực');
  return { recorded: true, isNegative };
}

// ── Báo cáo ──────────────────────────────────────────────────────────────────

/** Điểm hài lòng tổng hợp: NPS score hoặc CSAT trung bình, kèm phân rã theo bác sĩ. */
export async function surveyReport(surveyId: string) {
  const survey = await getSurvey(surveyId);
  const rows = await db
    .selectFrom('survey_responses')
    .select(['score', 'doctor_id', 'is_negative'])
    .where('survey_id', '=', surveyId)
    .execute();

  const overall = computeMetrics(survey.type, rows.map((r) => r.score));
  const negativeCount = rows.filter((r) => r.is_negative).length;

  // Phân rã theo bác sĩ.
  const byDoctorMap = new Map<string, (number | null)[]>();
  for (const r of rows) {
    if (!r.doctor_id) continue;
    const arr = byDoctorMap.get(r.doctor_id) ?? [];
    arr.push(r.score);
    byDoctorMap.set(r.doctor_id, arr);
  }
  const doctorIds = [...byDoctorMap.keys()];
  const doctorNames = new Map<string, string>();
  if (doctorIds.length > 0) {
    const users = await db.selectFrom('users').select(['id', 'full_name']).where('id', 'in', doctorIds).execute();
    for (const u of users) doctorNames.set(u.id, u.full_name);
  }
  const byDoctor = doctorIds.map((id) => ({
    doctorId: id,
    doctorName: doctorNames.get(id) ?? '(không rõ)',
    ...computeMetrics(survey.type, byDoctorMap.get(id)!),
  }));

  return { surveyId, name: survey.name, type: survey.type, totalResponses: rows.length, negativeCount, overall, byDoctor };
}

function computeMetrics(type: SurveyType, scores: (number | null)[]) {
  const s = scores.filter((x): x is number => x !== null);
  const total = s.length;
  if (total === 0) return { total: 0 };
  if (type === 'nps') {
    const promoters = s.filter((x) => x >= 9).length;
    const detractors = s.filter((x) => x <= 6).length;
    return {
      total,
      promoters,
      passives: s.filter((x) => x >= 7 && x <= 8).length,
      detractors,
      npsScore: Math.round(((promoters - detractors) / total) * 100),
    };
  }
  if (type === 'csat') {
    const satisfied = s.filter((x) => x >= 4).length;
    return {
      total,
      avgScore: Math.round((s.reduce((a, b) => a + b, 0) / total) * 100) / 100,
      satisfiedPercent: Math.round((satisfied / total) * 100),
    };
  }
  return { total, avgScore: Math.round((s.reduce((a, b) => a + b, 0) / total) * 100) / 100 };
}

/** Xu hướng hài lòng theo tháng. */
export async function surveyTrend(surveyId: string) {
  const survey = await getSurvey(surveyId);
  // Gộp theo tháng trong JS (đơn giản, tránh khác biệt hàm date giữa môi trường).
  const byMonth = new Map<string, { count: number; sum: number }>();
  const raw = await db
    .selectFrom('survey_responses')
    .select(['score', 'submitted_at'])
    .where('survey_id', '=', surveyId)
    .where('score', 'is not', null)
    .execute();
  for (const r of raw) {
    const d = new Date(r.submitted_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const cur = byMonth.get(key) ?? { count: 0, sum: 0 };
    cur.count++;
    cur.sum += r.score ?? 0;
    byMonth.set(key, cur);
  }
  return {
    surveyId,
    type: survey.type,
    trend: [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, count: v.count, avgScore: Math.round((v.sum / v.count) * 100) / 100 })),
  };
}

/** Danh sách phản hồi tiêu cực (giải mã góp ý) — để CSKH xử lý. Ghi phi_access. */
export async function listNegative(surveyId: string, actor: Actor, meta: RequestMeta) {
  const rows = await db
    .selectFrom('survey_responses as r')
    .innerJoin('patients as p', 'p.id', 'r.patient_id')
    .select(['r.id', 'r.score', 'r.comment_enc', 'r.submitted_at', 'r.patient_id', 'r.doctor_id', 'p.mrn', 'p.dek_id'])
    .where('r.survey_id', '=', surveyId)
    .where('r.is_negative', '=', true)
    .orderBy('r.submitted_at', 'desc')
    .execute();

  const result = [];
  for (const r of rows) {
    let comment: string | null = null;
    try {
      const dek = await loadDek(db, r.dek_id);
      try {
        comment = decryptOptionalField(r.comment_enc, dek);
      } finally {
        zeroize(dek);
      }
    } catch {
      comment = null; // dek bị shred → bỏ qua góp ý
    }
    result.push({ id: r.id, mrn: r.mrn, score: r.score, comment, doctorId: r.doctor_id, submittedAt: r.submitted_at });
  }

  if (rows.length > 0) {
    await db.transaction().execute((trx) =>
      writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'SURVEY_NEGATIVE_VIEW',
        entityType: 'survey',
        entityId: surveyId,
        reason: `count=${rows.length}`,
        ipAddress: meta.ipAddress,
      }),
    );
  }
  return result;
}
