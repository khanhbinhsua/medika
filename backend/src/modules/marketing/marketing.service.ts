import type { Transaction } from 'kysely';
import { sql } from 'kysely';
import { db } from '../../db/index.js';
import type { Database, SegmentCriteria, CampaignStatus } from '../../db/types.js';
import { writeAuditLog } from '../../audit/audit-logger.js';
import { NotFoundError, ConflictError, ValidationError } from '../../middleware/errors.js';
import { loadDek } from '../../crypto/dek-store.js';
import { decryptField, zeroize } from '../../crypto/field-encryption.js';
import { DataDestroyedError } from '../../middleware/errors.js';
import { logger } from '../../config/logger.js';
import { sendNotification } from '../notification/notification.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';

type Db = typeof db | Transaction<Database>;

// ── Đánh giá segment (chỉ trên trường KHÔNG phải PHI, query bằng SQL) ──────

/**
 * Áp tiêu chí segment lên bảng patients, trả về query đã lọc (select p.id).
 * `requireMarketingConsent` = true thì loại bệnh nhân chưa đồng ý nhận marketing.
 * Số lần khám = số lịch hẹn status='completed'.
 */
function segmentQuery(criteria: SegmentCriteria, opts: { requireMarketingConsent?: boolean } = {}) {
  let q = db
    .selectFrom('patients as p')
    .where('p.deleted_at', 'is', null)
    .where('p.purged_at', 'is', null)
    .where('p.status', '=', 'active');

  if (criteria.gender) q = q.where('p.gender', '=', criteria.gender);

  if (criteria.newWithinDays !== undefined) {
    q = q.where('p.created_at', '>=', sql<Date>`now() - make_interval(days => ${criteria.newWithinDays})`);
  }

  // Số lần khám = số lịch hẹn 'completed'. Subquery tương quan, so sánh trực tiếp.
  if (criteria.minVisits !== undefined) {
    const min = criteria.minVisits;
    q = q.where((eb) =>
      eb(
        eb
          .selectFrom('appointments as a')
          .select((e) => e.fn.countAll<string>().as('c'))
          .where('a.patient_id', '=', eb.ref('p.id'))
          .where('a.status', '=', 'completed'),
        '>=',
        String(min),
      ),
    );
  }
  if (criteria.maxVisits !== undefined) {
    const max = criteria.maxVisits;
    q = q.where((eb) =>
      eb(
        eb
          .selectFrom('appointments as a')
          .select((e) => e.fn.countAll<string>().as('c'))
          .where('a.patient_id', '=', eb.ref('p.id'))
          .where('a.status', '=', 'completed'),
        '<=',
        String(max),
      ),
    );
  }

  if (criteria.conditionLike) {
    const like = `%${criteria.conditionLike}%`;
    q = q.where((eb) =>
      eb.exists(
        eb
          .selectFrom('patient_medical_history as mh')
          .select('mh.id')
          .where('mh.patient_id', '=', eb.ref('p.id'))
          .where((e) => e.or([e('mh.condition', 'ilike', like), e('mh.icd10_code', 'ilike', like)])),
      ),
    );
  }

  if (criteria.inactiveSinceDays !== undefined) {
    // Win-back: KHÔNG có lịch hẹn nào trong N ngày gần đây.
    q = q.where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('appointments as a')
            .select('a.id')
            .where('a.patient_id', '=', eb.ref('p.id'))
            .where('a.scheduled_start', '>=', sql<Date>`now() - make_interval(days => ${criteria.inactiveSinceDays})`),
        ),
      ),
    );
  }

  // Tổng chi tiêu (sổ chi tiêu khách hàng) — nhắm khách VIP / theo ngưỡng chi.
  if (criteria.minTotalSpend !== undefined) {
    const min = criteria.minTotalSpend;
    q = q.where(
      sql<boolean>`(SELECT coalesce(sum(amount), 0) FROM patient_transactions t WHERE t.patient_id = p.id AND t.deleted_at IS NULL) >= ${min}`,
    );
  }
  if (criteria.maxTotalSpend !== undefined) {
    const max = criteria.maxTotalSpend;
    q = q.where(
      sql<boolean>`(SELECT coalesce(sum(amount), 0) FROM patient_transactions t WHERE t.patient_id = p.id AND t.deleted_at IS NULL) <= ${max}`,
    );
  }

  if (opts.requireMarketingConsent) {
    q = q.where((eb) =>
      eb.exists(
        eb
          .selectFrom('patient_consents as c')
          .select('c.id')
          .where('c.patient_id', '=', eb.ref('p.id'))
          .where('c.consent_type', '=', 'marketing')
          .where('c.granted', '=', true)
          .where('c.revoked_at', 'is', null),
      ),
    );
  }

  return q;
}

async function evalSegmentIds(criteria: SegmentCriteria, opts: { requireMarketingConsent?: boolean } = {}): Promise<string[]> {
  const rows = await segmentQuery(criteria, opts).select('p.id').execute();
  return rows.map((r) => r.id);
}

// ── Segment CRUD ────────────────────────────────────────────────────────────

export interface SegmentDto {
  id: string;
  name: string;
  description: string | null;
  criteria: SegmentCriteria;
  active: boolean;
  createdAt: Date;
}

function toSegmentDto(r: {
  id: string;
  name: string;
  description: string | null;
  criteria: SegmentCriteria;
  active: boolean;
  created_at: Date;
}): SegmentDto {
  return { id: r.id, name: r.name, description: r.description, criteria: r.criteria, active: r.active, createdAt: r.created_at };
}

export async function createSegment(
  input: { name: string; description?: string | undefined; criteria: SegmentCriteria },
  actor: Actor,
  meta: RequestMeta,
): Promise<SegmentDto> {
  const row = await db
    .insertInto('customer_segments')
    .values({
      name: input.name,
      description: input.description ?? null,
      criteria: JSON.stringify(input.criteria),
      created_by: actor.id,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db.transaction().execute((trx) =>
    writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'SEGMENT_CREATE',
      entityType: 'customer_segment',
      entityId: row.id,
      reason: `name=${input.name}`,
      ipAddress: meta.ipAddress,
    }),
  );
  return toSegmentDto(row);
}

export async function listSegments(): Promise<SegmentDto[]> {
  const rows = await db.selectFrom('customer_segments').selectAll().orderBy('created_at', 'desc').execute();
  return rows.map(toSegmentDto);
}

export async function updateSegment(
  id: string,
  input: {
    name?: string | undefined;
    description?: string | null | undefined;
    criteria?: SegmentCriteria | undefined;
    active?: boolean | undefined;
  },
): Promise<SegmentDto> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.criteria !== undefined) patch.criteria = JSON.stringify(input.criteria);
  if (input.active !== undefined) patch.active = input.active;
  if (Object.keys(patch).length === 0) patch.updated_at = new Date();
  const row = await db
    .updateTable('customer_segments')
    .set(patch)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst();
  if (!row) throw new NotFoundError('Nhóm khách hàng');
  return toSegmentDto(row);
}

export async function deleteSegment(id: string): Promise<void> {
  const res = await db.deleteFrom('customer_segments').where('id', '=', id).executeTakeFirst();
  if (Number(res.numDeletedRows) === 0) throw new NotFoundError('Nhóm khách hàng');
}

/** Xem trước thành viên: đếm + mẫu MRN. Ghi phi_access_log (segment lộ thông tin nhóm). */
export async function previewSegment(
  idOrCriteria: string | SegmentCriteria,
  actor: Actor,
  meta: RequestMeta,
): Promise<{ count: number; sample: { patientId: string; mrn: string }[] }> {
  const criteria = await resolveCriteria(idOrCriteria);
  const ids = await evalSegmentIds(criteria);
  const sample =
    ids.length === 0
      ? []
      : await db.selectFrom('patients').select(['id', 'mrn']).where('id', 'in', ids.slice(0, 10)).execute();

  if (ids.length > 0) {
    await db.transaction().execute((trx) =>
      writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'SEGMENT_PREVIEW',
        entityType: 'customer_segment',
        reason: `matched=${ids.length}`,
        ipAddress: meta.ipAddress,
      }),
    );
  }
  return { count: ids.length, sample: sample.map((s) => ({ patientId: s.id, mrn: s.mrn })) };
}

async function resolveCriteria(idOrCriteria: string | SegmentCriteria): Promise<SegmentCriteria> {
  if (typeof idOrCriteria !== 'string') return idOrCriteria;
  const seg = await db
    .selectFrom('customer_segments')
    .select('criteria')
    .where('id', '=', idOrCriteria)
    .executeTakeFirst();
  if (!seg) throw new NotFoundError('Nhóm khách hàng');
  return seg.criteria;
}

// ── Chiến dịch ──────────────────────────────────────────────────────────────

export interface CampaignDto {
  id: string;
  name: string;
  segmentId: string | null;
  kind: string;
  message: string;
  status: CampaignStatus;
  scheduledAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
}

function toCampaignDto(r: {
  id: string;
  name: string;
  segment_id: string | null;
  kind: string;
  message: string;
  status: CampaignStatus;
  scheduled_at: Date | null;
  sent_at: Date | null;
  created_at: Date;
}): CampaignDto {
  return {
    id: r.id,
    name: r.name,
    segmentId: r.segment_id,
    kind: r.kind,
    message: r.message,
    status: r.status,
    scheduledAt: r.scheduled_at,
    sentAt: r.sent_at,
    createdAt: r.created_at,
  };
}

export async function createCampaign(
  input: {
    name: string;
    segmentId: string;
    message: string;
    kind?: 'marketing' | 'treatment_next' | undefined;
    scheduledAt?: string | undefined;
  },
  actor: Actor,
  meta: RequestMeta,
): Promise<CampaignDto> {
  const seg = await db.selectFrom('customer_segments').select('id').where('id', '=', input.segmentId).executeTakeFirst();
  if (!seg) throw new NotFoundError('Nhóm khách hàng');

  const row = await db
    .insertInto('campaigns')
    .values({
      name: input.name,
      segment_id: input.segmentId,
      kind: input.kind ?? 'marketing',
      message: input.message,
      status: input.scheduledAt ? 'scheduled' : 'draft',
      scheduled_at: input.scheduledAt ? new Date(input.scheduledAt) : null,
      created_by: actor.id,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db.transaction().execute((trx) =>
    writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'CAMPAIGN_CREATE',
      entityType: 'campaign',
      entityId: row.id,
      reason: `name=${input.name}`,
      ipAddress: meta.ipAddress,
    }),
  );
  return toCampaignDto(row);
}

export async function listCampaigns(): Promise<CampaignDto[]> {
  const rows = await db.selectFrom('campaigns').selectAll().orderBy('created_at', 'desc').execute();
  return rows.map(toCampaignDto);
}

export interface CampaignSendResult {
  campaignId: string;
  eligible: number;
  sent: number;
  failed: number;
  skippedNoConsent: number;
}

/**
 * Gửi chiến dịch tới thành viên segment. Với kind='marketing' CHỈ gửi cho bệnh
 * nhân đã đồng ý nhận marketing (patient_consents) — ép ngay khi chốt danh sách.
 * Mỗi người nhận tạo một notification đa kênh (Module 8), lưu ảnh chụp recipient.
 */
export async function sendCampaign(campaignId: string, actor: Actor, meta: RequestMeta): Promise<CampaignSendResult> {
  const campaign = await db.selectFrom('campaigns').selectAll().where('id', '=', campaignId).executeTakeFirst();
  if (!campaign) throw new NotFoundError('Chiến dịch');
  if (campaign.status === 'sent') throw new ConflictError('Chiến dịch đã được gửi');
  if (campaign.status === 'cancelled') throw new ConflictError('Chiến dịch đã huỷ');
  // Status 'sending' KHÔNG bị chặn: gửi trong một request là đồng bộ, nên còn
  // thấy 'sending' ở request sau nghĩa là lần trước chết giữa chừng — cho gửi
  // lại để hồi phục. An toàn nhờ bỏ qua người đã 'sent' (idempotent, không gửi đúp).
  if (!campaign.segment_id) throw new ValidationError('Chiến dịch chưa gắn nhóm khách hàng');
  const prevStatus = campaign.status;

  const criteria = await resolveCriteria(campaign.segment_id);
  const requireConsent = campaign.kind === 'marketing';
  const allIds = await evalSegmentIds(criteria);
  const eligibleIds = requireConsent ? await evalSegmentIds(criteria, { requireMarketingConsent: true }) : allIds;

  // Người đã gửi thành công ở lần trước (nếu có) — bỏ qua khi gửi lại.
  const alreadySent = new Set(
    (
      await db
        .selectFrom('campaign_recipients')
        .select('patient_id')
        .where('campaign_id', '=', campaignId)
        .where('status', '=', 'sent')
        .execute()
    ).map((r) => r.patient_id),
  );

  await db.updateTable('campaigns').set({ status: 'sending' }).where('id', '=', campaignId).execute();

  let sent = 0;
  let failed = 0;
  try {
    for (const patientId of eligibleIds) {
      if (alreadySent.has(patientId)) {
        sent++;
        continue;
      }
      const result = await sendNotification({
        patientId,
        kind: campaign.kind,
        vars: { noi_dung: campaign.message },
        relatedType: 'campaign',
        relatedId: campaignId,
        createdBy: actor.id,
      });
      const ok = result.status === 'sent';
      if (ok) sent++;
      else failed++;
      await db
        .insertInto('campaign_recipients')
        .values({
          campaign_id: campaignId,
          patient_id: patientId,
          notification_id: result.id,
          status: ok ? 'sent' : 'failed',
          sent_at: ok ? new Date() : null,
          error: ok ? null : 'send_failed',
        })
        .onConflict((oc) =>
          oc.columns(['campaign_id', 'patient_id']).doUpdateSet({
            notification_id: result.id,
            status: ok ? 'sent' : 'failed',
            sent_at: ok ? new Date() : null,
          }),
        )
        .execute();
    }
  } catch (err) {
    // Lỗi giữa chừng: trả status về trạng thái trước để còn gửi lại được.
    await db.updateTable('campaigns').set({ status: prevStatus }).where('id', '=', campaignId).execute();
    throw err;
  }

  await db.updateTable('campaigns').set({ status: 'sent', sent_at: new Date() }).where('id', '=', campaignId).execute();
  await db.transaction().execute((trx) =>
    writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'CAMPAIGN_SEND',
      entityType: 'campaign',
      entityId: campaignId,
      reason: `eligible=${eligibleIds.length} sent=${sent} failed=${failed} skippedNoConsent=${allIds.length - eligibleIds.length}`,
      ipAddress: meta.ipAddress,
    }),
  );

  return {
    campaignId,
    eligible: eligibleIds.length,
    sent,
    failed,
    skippedNoConsent: allIds.length - eligibleIds.length,
  };
}

/** Báo cáo hiệu quả: đếm người nhận theo trạng thái notification hiện tại (gồm đã đọc). */
export async function campaignReport(campaignId: string) {
  const campaign = await db.selectFrom('campaigns').select(['id', 'name']).where('id', '=', campaignId).executeTakeFirst();
  if (!campaign) throw new NotFoundError('Chiến dịch');

  // Trạng thái hiệu lực = trạng thái notification hiện tại (gồm 'read' từ webhook),
  // fallback về trạng thái recipient nếu chưa gắn notification. Gộp trong JS cho rõ.
  const rows = await db
    .selectFrom('campaign_recipients as cr')
    .leftJoin('notifications as n', 'n.id', 'cr.notification_id')
    .select(['cr.status as recipient_status', 'n.status as notification_status'])
    .where('cr.campaign_id', '=', campaignId)
    .execute();

  const total = rows.length;
  let delivered = 0;
  let read = 0;
  let failed = 0;
  for (const r of rows) {
    const status = r.notification_status ?? r.recipient_status;
    if (status === 'read') {
      read++;
      delivered++;
    } else if (status === 'sent') delivered++;
    else if (status === 'failed') failed++;
  }
  return {
    campaignId,
    name: campaign.name,
    total,
    delivered,
    read,
    failed,
    deliveryRate: total === 0 ? 0 : Math.round((delivered / total) * 100),
    readRate: delivered === 0 ? 0 : Math.round((read / delivered) * 100),
  };
}

// ── Chăm sóc hậu điều trị ─────────────────────────────────────────────────

/**
 * Lên lịch chăm sóc sau điều trị — gọi tự động khi phác đồ hoàn thành (Module 7)
 * hoặc thủ công. delayHours: gửi sau X giờ (mặc định 72h = 3 ngày).
 */
export async function schedulePostCare(
  trx: Db,
  input: {
    patientId: string;
    treatmentPlanId?: string | undefined;
    careType: string;
    message: string;
    delayHours?: number | undefined;
    createdBy?: string | undefined;
  },
): Promise<string> {
  const scheduledAt = new Date(Date.now() + (input.delayHours ?? 72) * 3600_000);
  const row = await trx
    .insertInto('post_treatment_care')
    .values({
      patient_id: input.patientId,
      treatment_plan_id: input.treatmentPlanId ?? null,
      care_type: input.careType,
      message: input.message,
      scheduled_at: scheduledAt,
      created_by: input.createdBy ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function listCareForPatient(patientId: string) {
  const rows = await db
    .selectFrom('post_treatment_care')
    .select(['id', 'care_type', 'status', 'scheduled_at', 'sent_at', 'treatment_plan_id'])
    .where('patient_id', '=', patientId)
    .orderBy('scheduled_at', 'desc')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    careType: r.care_type,
    status: r.status,
    scheduledAt: r.scheduled_at,
    sentAt: r.sent_at,
    treatmentPlanId: r.treatment_plan_id,
  }));
}

/** Gửi mọi chăm sóc tới hạn (status pending, scheduled_at <= now). Idempotent theo dòng. */
export async function dispatchDueCare(now = new Date()): Promise<{ processed: number; sent: number; failed: number }> {
  const due = await db
    .selectFrom('post_treatment_care')
    .select(['id', 'patient_id', 'message'])
    .where('status', '=', 'pending')
    .where('scheduled_at', '<=', now)
    .execute();

  let sent = 0;
  let failed = 0;
  for (const care of due) {
    const result = await sendNotification({
      patientId: care.patient_id,
      kind: 'treatment_next',
      vars: { noi_dung: care.message },
      relatedType: 'post_treatment_care',
      relatedId: care.id,
    });
    const ok = result.status === 'sent';
    if (ok) sent++;
    else failed++;
    await db
      .updateTable('post_treatment_care')
      .set({ status: ok ? 'sent' : 'pending', sent_at: ok ? new Date() : null, notification_id: result.id })
      .where('id', '=', care.id)
      .execute();
  }
  if (due.length > 0) logger.info({ processed: due.length, sent, failed }, 'Đã gửi chăm sóc hậu điều trị');
  return { processed: due.length, sent, failed };
}

// ── Chúc mừng sinh nhật ────────────────────────────────────────────────────

/**
 * Gửi lời chúc sinh nhật cho bệnh nhân có sinh nhật HÔM NAY. dob được mã hoá nên
 * phải giải mã từng bệnh nhân để so tháng-ngày (dob không rời khỏi hàm này) —
 * chấp nhận được với quy mô phòng khám, giữ dob mã hoá tại chỗ.
 *
 * CHỈ gửi cho người đã đồng ý nhận marketing. Idempotent trong năm: bỏ qua nếu
 * đã có thông báo sinh nhật cho bệnh nhân trong năm nay.
 */
export async function dispatchBirthday(
  message: string,
  now = new Date(),
): Promise<{ scanned: number; matched: number; sent: number; skippedNoConsent: number }> {
  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const patients = await db
    .selectFrom('patients')
    .select(['id', 'dob_enc', 'dek_id'])
    .where('deleted_at', 'is', null)
    .where('purged_at', 'is', null)
    .where('status', '=', 'active')
    .execute();

  let matched = 0;
  let sent = 0;
  let skippedNoConsent = 0;
  for (const p of patients) {
    let dob: string;
    try {
      const dek = await loadDek(db, p.dek_id);
      try {
        dob = decryptField(p.dob_enc, dek);
      } finally {
        zeroize(dek);
      }
    } catch (err) {
      if (err instanceof DataDestroyedError) continue;
      throw err;
    }
    if (dob.slice(5, 10) !== mmdd) continue;
    matched++;

    const consent = await db
      .selectFrom('patient_consents')
      .select('granted')
      .where('patient_id', '=', p.id)
      .where('consent_type', '=', 'marketing')
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (consent?.granted !== true) {
      skippedNoConsent++;
      continue;
    }

    // Chỉ bỏ qua khi năm nay ĐÃ GỬI ĐƯỢC (sent/read) — lần trước thất bại thì
    // vẫn thử lại, không "kẹt" cả năm vì một lần gửi hỏng.
    const already = await db
      .selectFrom('notifications')
      .select('id')
      .where('patient_id', '=', p.id)
      .where('related_type', '=', 'birthday')
      .where('created_at', '>=', yearStart)
      .where('status', 'in', ['sent', 'read'])
      .executeTakeFirst();
    if (already) continue;

    const result = await sendNotification({
      patientId: p.id,
      kind: 'marketing',
      vars: { noi_dung: message },
      relatedType: 'birthday',
    });
    if (result.status === 'sent') sent++;
  }
  logger.info({ scanned: patients.length, matched, sent, skippedNoConsent }, 'Đã gửi chúc mừng sinh nhật');
  return { scanned: patients.length, matched, sent, skippedNoConsent };
}

// ── Báo cáo tỷ lệ quay lại (retention) ─────────────────────────────────────

export async function retentionReport() {
  const row = await db
    .selectFrom('patients as p')
    .select((eb) => [
      eb.fn.countAll<string>().as('total_patients'),
      eb.fn
        .count<string>(
          sql`case when (select count(*) from appointments a where a.patient_id = p.id and a.status = 'completed') >= 1 then 1 end`,
        )
        .as('visited'),
      eb.fn
        .count<string>(
          sql`case when (select count(*) from appointments a where a.patient_id = p.id and a.status = 'completed') >= 2 then 1 end`,
        )
        .as('returned'),
    ])
    .where('p.deleted_at', 'is', null)
    .where('p.purged_at', 'is', null)
    .executeTakeFirstOrThrow();

  const visited = Number(row.visited);
  const returned = Number(row.returned);
  return {
    totalPatients: Number(row.total_patients),
    visited,
    returned,
    // Tỷ lệ quay lại = có >=2 lần khám hoàn thành / có >=1 lần khám.
    retentionRate: visited === 0 ? 0 : Math.round((returned / visited) * 100),
  };
}
