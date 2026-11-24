import type { Transaction } from 'kysely';
import { db } from '../../db/index.js';
import type { Database, TreatmentPlanStatus, TreatmentStepStatus } from '../../db/types.js';
import { writeAuditLog, writePhiAccessLog } from '../../audit/audit-logger.js';
import { NotFoundError, ValidationError, ConflictError } from '../../middleware/errors.js';
import { loadDek } from '../../crypto/dek-store.js';
import {
  encryptField,
  encryptOptionalField,
  decryptField,
  decryptOptionalField,
  zeroize,
} from '../../crypto/field-encryption.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import { schedulePostCare } from '../marketing/marketing.service.js';
import type {
  CreatePlanInput,
  CreateFromTemplateInput,
  AddStepInput,
  UpdateStepInput,
  CreateTemplateInput,
} from './treatment.schemas.js';

type Db = typeof db | Transaction<Database>;

// ── DTO ───────────────────────────────────────────────────────────────────

export interface TreatmentStepDto {
  id: string;
  stepOrder: number;
  title: string;
  description: string | null;
  cost: number;
  status: TreatmentStepStatus;
  scheduledDate: Date | null;
  completedAt: Date | null;
  appointmentId: string | null;
}

export interface TreatmentPlanDto {
  id: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  doctorId: string;
  doctorName: string;
  templateId: string | null;
  title: string;
  status: TreatmentPlanStatus;
  totalCost: number;
  progress: { completed: number; total: number; percent: number };
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  cancelReason: string | null;
  cancelledAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  steps: TreatmentStepDto[];
}

// ── Máy trạng thái phác đồ ─────────────────────────────────────────────────
// draft → pending_approval → active → completed. Huỷ được từ mọi trạng thái
// chưa chốt sổ. Không quay lui: đã completed/cancelled là chốt.
const PLAN_TERMINAL: TreatmentPlanStatus[] = ['completed', 'cancelled'];
const STEP_TERMINAL: TreatmentStepStatus[] = ['completed', 'skipped', 'cancelled'];

// ── Helpers ────────────────────────────────────────────────────────────────

async function loadPatientKey(trx: Db, patientId: string) {
  const patient = await trx
    .selectFrom('patients')
    .select(['id', 'mrn', 'dek_id', 'first_name_enc', 'last_name_enc'])
    .where('id', '=', patientId)
    .where('deleted_at', 'is', null)
    .where('purged_at', 'is', null)
    .executeTakeFirst();
  if (!patient) throw new NotFoundError('Bệnh nhân');
  return patient;
}

async function assertActiveDoctor(doctorId: string): Promise<void> {
  const doctor = await db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select(['users.status', 'roles.name as role_name'])
    .where('users.id', '=', doctorId)
    .executeTakeFirst();
  if (!doctor) throw new NotFoundError('Bác sĩ');
  if (doctor.role_name !== 'doctor') throw new ValidationError('Tài khoản được chọn không phải bác sĩ');
  if (doctor.status !== 'active') throw new ValidationError('Tài khoản bác sĩ đang bị vô hiệu hoá');
}

/** Đồng bộ total_cost = tổng cost các bước CHƯA huỷ. Gọi sau mọi thay đổi bước. */
async function recalcTotal(trx: Db, planId: string): Promise<void> {
  const row = await trx
    .selectFrom('treatment_steps')
    .select((eb) => eb.fn.sum<string>('cost').as('sum'))
    .where('treatment_plan_id', '=', planId)
    .where('status', '!=', 'cancelled')
    .executeTakeFirst();
  await trx
    .updateTable('treatment_plans')
    .set({ total_cost: row?.sum ?? 0 })
    .where('id', '=', planId)
    .execute();
}

async function loadPlanRow(trx: Db, planId: string) {
  const plan = await trx
    .selectFrom('treatment_plans')
    .selectAll()
    .where('id', '=', planId)
    .executeTakeFirst();
  if (!plan) throw new NotFoundError('Phác đồ điều trị');
  return plan;
}

/** Dựng DTO đầy đủ (giải mã tên bệnh nhân + nội dung lâm sàng bằng DEK). */
async function buildDto(trx: Db, planId: string): Promise<TreatmentPlanDto> {
  const plan = await loadPlanRow(trx, planId);
  const patient = await trx
    .selectFrom('patients')
    .select(['id', 'mrn', 'dek_id', 'first_name_enc', 'last_name_enc'])
    .where('id', '=', plan.patient_id)
    .executeTakeFirstOrThrow();
  const doctor = await trx
    .selectFrom('users')
    .select(['id', 'full_name'])
    .where('id', '=', plan.doctor_id)
    .executeTakeFirst();
  const approver = plan.approved_by
    ? await trx.selectFrom('users').select(['full_name']).where('id', '=', plan.approved_by).executeTakeFirst()
    : null;
  const steps = await trx
    .selectFrom('treatment_steps')
    .selectAll()
    .where('treatment_plan_id', '=', planId)
    .orderBy('step_order', 'asc')
    .execute();

  const dek = await loadDek(trx, patient.dek_id);
  try {
    const stepDtos: TreatmentStepDto[] = steps.map((s) => ({
      id: s.id,
      stepOrder: s.step_order,
      title: decryptField(s.title_enc, dek),
      description: decryptOptionalField(s.description_enc, dek),
      cost: Number(s.cost),
      status: s.status,
      scheduledDate: s.scheduled_date,
      completedAt: s.completed_at,
      appointmentId: s.appointment_id,
    }));
    const active = stepDtos.filter((s) => s.status !== 'cancelled');
    const completed = active.filter((s) => s.status === 'completed').length;
    return {
      id: plan.id,
      patientId: plan.patient_id,
      patientName: `${decryptField(patient.last_name_enc, dek)} ${decryptField(patient.first_name_enc, dek)}`.trim(),
      patientMrn: patient.mrn,
      doctorId: plan.doctor_id,
      doctorName: doctor?.full_name ?? '(không rõ)',
      templateId: plan.template_id,
      title: decryptField(plan.title_enc, dek),
      status: plan.status,
      totalCost: Number(plan.total_cost),
      progress: {
        completed,
        total: active.length,
        percent: active.length === 0 ? 0 : Math.round((completed / active.length) * 100),
      },
      approvedBy: plan.approved_by,
      approvedByName: approver?.full_name ?? null,
      approvedAt: plan.approved_at,
      cancelReason: decryptOptionalField(plan.cancel_reason_enc, dek),
      cancelledAt: plan.cancelled_at,
      createdBy: plan.created_by,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at,
      steps: stepDtos,
    };
  } finally {
    zeroize(dek);
  }
}

// ── Tạo phác đồ ────────────────────────────────────────────────────────────

export async function createPlan(input: CreatePlanInput, actor: Actor, meta: RequestMeta): Promise<TreatmentPlanDto> {
  await assertActiveDoctor(input.doctorId);
  return db.transaction().execute(async (trx) => {
    const patient = await loadPatientKey(trx, input.patientId);
    const dek = await loadDek(trx, patient.dek_id);
    try {
      const plan = await trx
        .insertInto('treatment_plans')
        .values({
          patient_id: input.patientId,
          doctor_id: input.doctorId,
          title_enc: encryptField(input.title, dek),
          status: 'draft',
          created_by: actor.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const steps = input.steps ?? [];
      if (steps.length > 0) {
        await trx
          .insertInto('treatment_steps')
          .values(
            steps.map((s, i) => ({
              treatment_plan_id: plan.id,
              step_order: i + 1,
              title_enc: encryptField(s.title, dek),
              description_enc: encryptOptionalField(s.description, dek),
              cost: s.cost ?? 0,
              scheduled_date: s.scheduledDate ? new Date(s.scheduledDate) : null,
            })),
          )
          .execute();
        await recalcTotal(trx, plan.id);
      }

      await auditPlan(trx, meta, actor, 'TREATMENT_PLAN_CREATE', plan.id, input.patientId, `steps=${steps.length}`);
      return buildDto(trx, plan.id);
    } finally {
      zeroize(dek);
    }
  });
}

export async function createFromTemplate(
  input: CreateFromTemplateInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<TreatmentPlanDto> {
  await assertActiveDoctor(input.doctorId);
  return db.transaction().execute(async (trx) => {
    const template = await trx
      .selectFrom('treatment_plan_templates')
      .selectAll()
      .where('id', '=', input.templateId)
      .where('active', '=', true)
      .executeTakeFirst();
    if (!template) throw new NotFoundError('Template phác đồ');
    const tplSteps = await trx
      .selectFrom('treatment_plan_template_steps')
      .selectAll()
      .where('template_id', '=', input.templateId)
      .orderBy('step_order', 'asc')
      .execute();

    const patient = await loadPatientKey(trx, input.patientId);
    const dek = await loadDek(trx, patient.dek_id);
    try {
      const plan = await trx
        .insertInto('treatment_plans')
        .values({
          patient_id: input.patientId,
          doctor_id: input.doctorId,
          template_id: template.id,
          title_enc: encryptField(input.title ?? template.name, dek),
          status: 'draft',
          created_by: actor.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (tplSteps.length > 0) {
        await trx
          .insertInto('treatment_steps')
          .values(
            tplSteps.map((s) => ({
              treatment_plan_id: plan.id,
              step_order: s.step_order,
              title_enc: encryptField(s.title, dek),
              description_enc: encryptOptionalField(s.description, dek),
              cost: s.estimated_cost,
            })),
          )
          .execute();
        await recalcTotal(trx, plan.id);
      }

      await auditPlan(
        trx,
        meta,
        actor,
        'TREATMENT_PLAN_CREATE',
        plan.id,
        input.patientId,
        `template=${template.code} steps=${tplSteps.length}`,
      );
      return buildDto(trx, plan.id);
    } finally {
      zeroize(dek);
    }
  });
}

// ── Đọc ────────────────────────────────────────────────────────────────────

export async function getPlan(planId: string, actor: Actor, meta: RequestMeta): Promise<TreatmentPlanDto> {
  const dto = await db.transaction().execute(async (trx) => {
    const plan = await loadPlanRow(trx, planId);
    await writePhiAccessLog(trx, {
      requestId: meta.requestId,
      patientId: plan.patient_id,
      accessedBy: actor.id,
      accessType: 'view',
      fieldsAccessed: ['treatment_plan'],
      ipAddress: meta.ipAddress,
    });
    return buildDto(trx, planId);
  });
  return dto;
}

export async function listPlansForPatient(
  patientId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<TreatmentPlanDto[]> {
  const ids = await db
    .selectFrom('treatment_plans')
    .select('id')
    .where('patient_id', '=', patientId)
    .orderBy('created_at', 'desc')
    .execute();
  if (ids.length === 0) return [];

  return db.transaction().execute(async (trx) => {
    await writePhiAccessLog(trx, {
      requestId: meta.requestId,
      patientId,
      accessedBy: actor.id,
      accessType: 'view',
      fieldsAccessed: ['treatment_plan'],
      ipAddress: meta.ipAddress,
    });
    const out: TreatmentPlanDto[] = [];
    for (const { id } of ids) out.push(await buildDto(trx, id));
    return out;
  });
}

/** Lịch sử thay đổi phác đồ = các bản ghi audit (đã chuỗi-băm chống sửa) của entity. */
export async function getPlanHistory(planId: string) {
  const rows = await db
    .selectFrom('audit_logs')
    .select(['action', 'actor_email', 'reason', 'created_at'])
    .where('entity_type', '=', 'treatment_plan')
    .where('entity_id', '=', planId)
    .orderBy('created_at', 'asc')
    .execute();
  return rows.map((r) => ({
    action: r.action,
    actor: r.actor_email,
    detail: r.reason,
    at: r.created_at,
  }));
}

// ── Bước điều trị ──────────────────────────────────────────────────────────

export async function addStep(planId: string, input: AddStepInput, actor: Actor, meta: RequestMeta): Promise<TreatmentPlanDto> {
  return db.transaction().execute(async (trx) => {
    const plan = await loadPlanRow(trx, planId);
    if (PLAN_TERMINAL.includes(plan.status)) throw new ConflictError('Phác đồ đã chốt sổ, không thêm bước được');
    const patient = await loadPatientKey(trx, plan.patient_id);
    const dek = await loadDek(trx, patient.dek_id);
    try {
      const max = await trx
        .selectFrom('treatment_steps')
        .select((eb) => eb.fn.max<number>('step_order').as('m'))
        .where('treatment_plan_id', '=', planId)
        .executeTakeFirst();
      await trx
        .insertInto('treatment_steps')
        .values({
          treatment_plan_id: planId,
          step_order: (max?.m ?? 0) + 1,
          title_enc: encryptField(input.title, dek),
          description_enc: encryptOptionalField(input.description, dek),
          cost: input.cost ?? 0,
          scheduled_date: input.scheduledDate ? new Date(input.scheduledDate) : null,
        })
        .execute();
      await recalcTotal(trx, planId);
      await auditPlan(trx, meta, actor, 'TREATMENT_STEP_ADD', planId, plan.patient_id);
      return buildDto(trx, planId);
    } finally {
      zeroize(dek);
    }
  });
}

export async function updateStep(
  planId: string,
  stepId: string,
  input: UpdateStepInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<TreatmentPlanDto> {
  return db.transaction().execute(async (trx) => {
    const plan = await loadPlanRow(trx, planId);
    if (PLAN_TERMINAL.includes(plan.status)) throw new ConflictError('Phác đồ đã chốt sổ, không sửa bước được');
    const step = await trx
      .selectFrom('treatment_steps')
      .selectAll()
      .where('id', '=', stepId)
      .where('treatment_plan_id', '=', planId)
      .executeTakeFirst();
    if (!step) throw new NotFoundError('Bước điều trị');

    if (input.appointmentId) {
      const appt = await trx
        .selectFrom('appointments')
        .select(['id', 'patient_id'])
        .where('id', '=', input.appointmentId)
        .executeTakeFirst();
      if (!appt) throw new NotFoundError('Lịch hẹn');
      // Bước chỉ được gắn với lịch hẹn của CHÍNH bệnh nhân này.
      if (appt.patient_id !== plan.patient_id) throw new ValidationError('Lịch hẹn không thuộc bệnh nhân của phác đồ');
    }

    const patient = await loadPatientKey(trx, plan.patient_id);
    const dek = await loadDek(trx, patient.dek_id);
    try {
      const patch: Record<string, unknown> = {};
      if (input.title !== undefined) patch.title_enc = encryptField(input.title, dek);
      if (input.description !== undefined) patch.description_enc = encryptOptionalField(input.description, dek);
      if (input.cost !== undefined) patch.cost = input.cost;
      if (input.scheduledDate !== undefined)
        patch.scheduled_date = input.scheduledDate ? new Date(input.scheduledDate) : null;
      if (input.appointmentId !== undefined) patch.appointment_id = input.appointmentId;
      if (input.status !== undefined) {
        patch.status = input.status;
        // Chuyển sang completed → ghi mốc hoàn thành; rời completed → xoá mốc.
        if (input.status === 'completed') patch.completed_at = new Date();
        else if (step.status === 'completed') patch.completed_at = null;
      }

      await trx.updateTable('treatment_steps').set(patch).where('id', '=', stepId).execute();
      if (input.cost !== undefined || input.status !== undefined) await recalcTotal(trx, planId);

      await maybeAutoComplete(trx, planId, plan.patient_id, plan.status);
      await auditPlan(
        trx,
        meta,
        actor,
        'TREATMENT_STEP_UPDATE',
        planId,
        plan.patient_id,
        input.status ? `step_status=${input.status}` : undefined,
      );
      return buildDto(trx, planId);
    } finally {
      zeroize(dek);
    }
  });
}

/**
 * Nếu phác đồ đang active và mọi bước đã ở trạng thái chốt → tự hoàn thành.
 * Khi hoàn thành, tự lên lịch một lần CHĂM SÓC HẬU ĐIỀU TRỊ (Module 9) gửi sau
 * 72h — nối liền điều trị với CSKH mà không cần thao tác tay.
 */
async function maybeAutoComplete(
  trx: Db,
  planId: string,
  patientId: string,
  currentStatus: TreatmentPlanStatus,
): Promise<void> {
  if (currentStatus !== 'active') return;
  const steps = await trx
    .selectFrom('treatment_steps')
    .select(['status'])
    .where('treatment_plan_id', '=', planId)
    .execute();
  if (steps.length === 0) return;
  const allTerminal = steps.every((s) => STEP_TERMINAL.includes(s.status));
  const anyCompleted = steps.some((s) => s.status === 'completed');
  if (allTerminal && anyCompleted) {
    await trx.updateTable('treatment_plans').set({ status: 'completed' }).where('id', '=', planId).execute();
    await schedulePostCare(trx, {
      patientId,
      treatmentPlanId: planId,
      careType: 'follow_up',
      message: 'Cảm ơn bạn đã hoàn thành liệu trình. Nếu có bất kỳ dấu hiệu bất thường nào, vui lòng liên hệ phòng khám để được hỗ trợ.',
    });
  }
}

// ── Chuyển trạng thái phác đồ ──────────────────────────────────────────────

export async function submitForApproval(planId: string, actor: Actor, meta: RequestMeta): Promise<TreatmentPlanDto> {
  return db.transaction().execute(async (trx) => {
    const plan = await loadPlanRow(trx, planId);
    if (plan.status !== 'draft') throw new ConflictError('Chỉ phác đồ nháp mới gửi duyệt được');
    const count = await trx
      .selectFrom('treatment_steps')
      .select((eb) => eb.fn.countAll<string>().as('c'))
      .where('treatment_plan_id', '=', planId)
      .executeTakeFirstOrThrow();
    if (Number(count.c) === 0) throw new ValidationError('Phác đồ cần ít nhất một bước trước khi gửi duyệt');

    await trx.updateTable('treatment_plans').set({ status: 'pending_approval' }).where('id', '=', planId).execute();
    await auditPlan(trx, meta, actor, 'TREATMENT_PLAN_SUBMIT', planId, plan.patient_id);
    return buildDto(trx, planId);
  });
}

export async function approvePlan(planId: string, actor: Actor, meta: RequestMeta): Promise<TreatmentPlanDto> {
  return db.transaction().execute(async (trx) => {
    const plan = await loadPlanRow(trx, planId);
    if (plan.status !== 'pending_approval') throw new ConflictError('Chỉ phác đồ đang chờ duyệt mới phê duyệt được');
    // Tách vai trò (separation of duties): người duyệt PHẢI khác bác sĩ phụ trách
    // VÀ khác người tạo — không ai tự duyệt phác đồ của chính mình.
    if (actor.id === plan.doctor_id || actor.id === plan.created_by) {
      throw new ValidationError('Người phê duyệt phải khác bác sĩ phụ trách và người tạo phác đồ');
    }
    await trx
      .updateTable('treatment_plans')
      .set({ status: 'active', approved_by: actor.id, approved_at: new Date() })
      .where('id', '=', planId)
      .execute();
    await auditPlan(trx, meta, actor, 'TREATMENT_PLAN_APPROVE', planId, plan.patient_id);
    return buildDto(trx, planId);
  });
}

export async function cancelPlan(
  planId: string,
  reason: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<TreatmentPlanDto> {
  return db.transaction().execute(async (trx) => {
    const plan = await loadPlanRow(trx, planId);
    if (PLAN_TERMINAL.includes(plan.status)) throw new ConflictError('Phác đồ đã chốt sổ');
    const patient = await loadPatientKey(trx, plan.patient_id);
    const dek = await loadDek(trx, patient.dek_id);
    try {
      await trx
        .updateTable('treatment_plans')
        .set({ status: 'cancelled', cancelled_at: new Date(), cancel_reason_enc: encryptField(reason, dek) })
        .where('id', '=', planId)
        .execute();
    } finally {
      zeroize(dek);
    }
    await auditPlan(trx, meta, actor, 'TREATMENT_PLAN_CANCEL', planId, plan.patient_id);
    return buildDto(trx, planId);
  });
}

// ── Template ───────────────────────────────────────────────────────────────

export interface TemplateDto {
  id: string;
  code: string;
  name: string;
  condition: string | null;
  description: string | null;
  active: boolean;
  steps: { stepOrder: number; title: string; description: string | null; estimatedCost: number }[];
}

export async function listTemplates(): Promise<TemplateDto[]> {
  const templates = await db.selectFrom('treatment_plan_templates').selectAll().orderBy('name', 'asc').execute();
  const steps = await db
    .selectFrom('treatment_plan_template_steps')
    .selectAll()
    .orderBy('step_order', 'asc')
    .execute();
  return templates.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    condition: t.condition,
    description: t.description,
    active: t.active,
    steps: steps
      .filter((s) => s.template_id === t.id)
      .map((s) => ({
        stepOrder: s.step_order,
        title: s.title,
        description: s.description,
        estimatedCost: Number(s.estimated_cost),
      })),
  }));
}

export async function createTemplate(input: CreateTemplateInput, actor: Actor, meta: RequestMeta): Promise<TemplateDto> {
  const templateId = await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('treatment_plan_templates')
      .select('id')
      .where('code', '=', input.code)
      .executeTakeFirst();
    if (existing) throw new ConflictError(`Template mã "${input.code}" đã tồn tại`);

    const tpl = await trx
      .insertInto('treatment_plan_templates')
      .values({
        code: input.code,
        name: input.name,
        condition: input.condition ?? null,
        description: input.description ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('treatment_plan_template_steps')
      .values(
        input.steps.map((s, i) => ({
          template_id: tpl.id,
          step_order: i + 1,
          title: s.title,
          description: s.description ?? null,
          estimated_cost: s.estimatedCost ?? 0,
        })),
      )
      .execute();

    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'TREATMENT_TEMPLATE_CREATE',
      entityType: 'treatment_plan_template',
      entityId: tpl.id,
      reason: `code=${input.code}`,
      ipAddress: meta.ipAddress,
    });
    return tpl.id;
  });

  // Đọc lại SAU khi commit — listTemplates dùng `db` toàn cục, không thấy dữ
  // liệu trong transaction chưa chốt.
  const dto = (await listTemplates()).find((t) => t.id === templateId);
  if (!dto) throw new NotFoundError('Template phác đồ');
  return dto;
}

// ── Audit chung ────────────────────────────────────────────────────────────

async function auditPlan(
  trx: Db,
  meta: RequestMeta,
  actor: Actor,
  action: string,
  planId: string,
  patientId: string,
  reason?: string,
): Promise<void> {
  await writeAuditLog(trx, {
    requestId: meta.requestId,
    actorId: actor.id,
    actorEmail: actor.email,
    action,
    entityType: 'treatment_plan',
    entityId: planId,
    ...(reason ? { reason } : {}),
    ipAddress: meta.ipAddress,
  });
  // Phác đồ gắn với chẩn đoán/điều trị của bệnh nhân → truy cập PHI.
  await writePhiAccessLog(trx, {
    requestId: meta.requestId,
    patientId,
    accessedBy: actor.id,
    accessType: 'modify',
    fieldsAccessed: ['treatment_plan'],
    ipAddress: meta.ipAddress,
  });
}
