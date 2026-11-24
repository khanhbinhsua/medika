import type { Transaction } from 'kysely';
import { db } from '../../db/index.js';
import type { Database, AppointmentStatus } from '../../db/types.js';
import { writeAuditLog, writePhiAccessLog, writePhiAccessLogs } from '../../audit/audit-logger.js';
import { NotFoundError, ConflictError, ValidationError } from '../../middleware/errors.js';
import { loadDek, loadDeks } from '../../crypto/dek-store.js';
import { encryptOptionalField, decryptOptionalField, zeroize } from '../../crypto/field-encryption.js';
import { scheduleForAppointment } from '../reminder/reminder.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import type {
  CreateAppointmentInput,
  UpdateAppointmentInput,
  ListAppointmentsQuery,
} from './appointment.schemas.js';

export interface AppointmentDto {
  id: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  doctorId: string;
  doctorName: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  room: string | null;
  status: AppointmentStatus;
  reason: string | null;
  cancelReason: string | null;
  checkedInAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

/**
 * Máy trạng thái lịch hẹn. Chỉ cho phép đi tới, không quay lui — một lịch đã
 * hoàn thành hoặc đã huỷ là chốt sổ, muốn sửa phải tạo lịch mới. Ràng buộc này
 * giữ cho dòng thời gian trong hồ sơ bệnh án không bị viết lại.
 */
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['confirmed', 'checked_in', 'cancelled', 'no_show'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'đã đặt',
  confirmed: 'đã xác nhận',
  checked_in: 'đã đến',
  in_progress: 'đang khám',
  completed: 'đã hoàn thành',
  cancelled: 'đã huỷ',
  no_show: 'không đến',
};

export async function createAppointment(
  input: CreateAppointmentInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<AppointmentDto> {
  await assertDoctor(input.doctorId);

  return db.transaction().execute(async (trx) => {
    const patient = await loadPatientKey(trx, input.patientId);
    const dek = await loadDek(trx, patient.dek_id);
    // Mốc 0 đa chi nhánh: gắn lịch vào chi nhánh mặc định (chọn chi nhánh cụ thể
    // sẽ bổ sung khi làm lại màn lịch hẹn ở Mốc 1).
    const defaultBranch = await trx
      .selectFrom('branches')
      .select('id')
      .where('is_default', '=', true)
      .executeTakeFirst();

    try {
      const row = await trx
        .insertInto('appointments')
        .values({
          patient_id: input.patientId,
          doctor_id: input.doctorId,
          branch_id: defaultBranch?.id ?? null,
          scheduled_start: new Date(input.scheduledStart),
          scheduled_end: new Date(input.scheduledEnd),
          room: input.room ?? null,
          reason_enc: encryptOptionalField(input.reason, dek),
          created_by: actor.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
        .catch(rethrowOverlap);

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'APPOINTMENT_CREATE',
        entityType: 'appointment',
        entityId: row.id,
        ipAddress: meta.ipAddress,
      });

      // Lịch hẹn gắn bệnh nhân với bác sĩ và thời điểm — bản thân mối liên hệ đó là PHI.
      await writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId: input.patientId,
        accessedBy: actor.id,
        accessType: 'create',
        fieldsAccessed: ['appointment'],
        ipAddress: meta.ipAddress,
      });

      // Tự lập lịch nhắc — trong cùng transaction, nếu tạo lịch hẹn rollback
      // thì reminder cũng biến mất, không có reminder mồ côi.
      await scheduleForAppointment(trx, {
        appointmentId: row.id,
        patientId: input.patientId,
        scheduledStart: new Date(input.scheduledStart),
        dek,
      });

      return toDto(row, dek, patient);
    } finally {
      zeroize(dek);
    }
  });
}

export async function listAppointments(query: ListAppointmentsQuery, actor: Actor, meta: RequestMeta) {
  let base = db
    .selectFrom('appointments')
    .innerJoin('patients', 'patients.id', 'appointments.patient_id')
    .innerJoin('users as doctor', 'doctor.id', 'appointments.doctor_id')
    .where('patients.deleted_at', 'is', null);

  if (query.patientId) base = base.where('appointments.patient_id', '=', query.patientId);
  if (query.doctorId) base = base.where('appointments.doctor_id', '=', query.doctorId);
  if (query.status) base = base.where('appointments.status', '=', query.status);
  if (query.from) base = base.where('appointments.scheduled_start', '>=', new Date(query.from));
  if (query.to) base = base.where('appointments.scheduled_start', '<=', new Date(query.to));

  const { count } = await base
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();

  const rows = await base
    .selectAll('appointments')
    .select([
      'patients.mrn as patient_mrn',
      'patients.first_name_enc',
      'patients.last_name_enc',
      'patients.dek_id',
      'doctor.full_name as doctor_name',
    ])
    .orderBy('appointments.scheduled_start', 'asc')
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .execute();

  const data: AppointmentDto[] = [];
  const deks = await loadDeks(db, rows.map((r) => r.dek_id));
  try {
    for (const row of rows) {
      data.push(toDto(row, deks.get(row.dek_id)!, row));
    }
  } finally {
    for (const dek of deks.values()) zeroize(dek);
  }

  if (data.length > 0) {
    const distinctPatientIds = [...new Set(data.map((a) => a.patientId))];
    await db.transaction().execute((trx) =>
      writePhiAccessLogs(
        trx,
        distinctPatientIds.map((id) => ({
          requestId: meta.requestId,
          patientId: id,
          accessedBy: actor.id,
          accessType: 'view' as const,
          fieldsAccessed: ['appointment'],
          ipAddress: meta.ipAddress,
        })),
      ),
    );
  }

  const total = Number(count);
  return {
    data,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

export async function getAppointment(id: string, actor: Actor, meta: RequestMeta): Promise<AppointmentDto> {
  const row = await selectFull(id);
  if (!row) throw new NotFoundError('Lịch hẹn');

  const dek = await loadDek(db, row.dek_id);
  try {
    const dto = toDto(row, dek, row);
    await db.transaction().execute((trx) =>
      writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId: row.patient_id,
        accessedBy: actor.id,
        accessType: 'view',
        fieldsAccessed: ['appointment'],
        ipAddress: meta.ipAddress,
      }),
    );
    return dto;
  } finally {
    zeroize(dek);
  }
}

export async function updateAppointment(
  id: string,
  input: UpdateAppointmentInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<AppointmentDto> {
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('appointments')
      .select(['id', 'patient_id', 'status'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();

    if (!current) throw new NotFoundError('Lịch hẹn');
    if (current.status === 'cancelled' || current.status === 'completed') {
      throw new ConflictError(`Không thể sửa lịch hẹn ${STATUS_LABELS[current.status]}`);
    }

    const patient = await loadPatientKey(trx, current.patient_id);
    const dek = await loadDek(trx, patient.dek_id);

    try {
      const patch: Record<string, unknown> = {};
      if (input.scheduledStart) patch.scheduled_start = new Date(input.scheduledStart);
      if (input.scheduledEnd) patch.scheduled_end = new Date(input.scheduledEnd);
      if (input.room !== undefined) patch.room = input.room;
      if (input.reason !== undefined) {
        patch.reason_enc = input.reason === null ? null : encryptOptionalField(input.reason, dek);
      }

      await trx.updateTable('appointments').set(patch).where('id', '=', id).execute().catch(rethrowOverlap);

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'APPOINTMENT_UPDATE',
        entityType: 'appointment',
        entityId: id,
        changes: Object.fromEntries(Object.keys(input).map((k) => [k, { old: '[REDACTED]', new: '[REDACTED]' }])),
        ipAddress: meta.ipAddress,
      });

      const row = await selectFull(id, trx);
      return toDto(row!, dek, row!);
    } finally {
      zeroize(dek);
    }
  });
}

export async function transition(
  id: string,
  next: AppointmentStatus,
  actor: Actor,
  meta: RequestMeta,
): Promise<AppointmentDto> {
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('appointments')
      .select(['id', 'patient_id', 'status'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();

    if (!current) throw new NotFoundError('Lịch hẹn');

    const allowed = ALLOWED_TRANSITIONS[current.status];
    if (!allowed.includes(next)) {
      throw new ConflictError(
        `Không thể chuyển lịch hẹn từ "${STATUS_LABELS[current.status]}" sang "${STATUS_LABELS[next]}"`,
      );
    }

    const now = new Date();
    const patch: Record<string, unknown> = { status: next };
    if (next === 'checked_in') patch.checked_in_at = now;
    if (next === 'completed') patch.completed_at = now;

    await trx.updateTable('appointments').set(patch).where('id', '=', id).execute();

    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'APPOINTMENT_TRANSITION',
      entityType: 'appointment',
      entityId: id,
      changes: { status: { old: current.status, new: next } },
      ipAddress: meta.ipAddress,
    });

    const row = await selectFull(id, trx);
    const dek = await loadDek(trx, row!.dek_id);
    try {
      return toDto(row!, dek, row!);
    } finally {
      zeroize(dek);
    }
  });
}

export async function cancelAppointment(
  id: string,
  reason: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<AppointmentDto> {
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('appointments')
      .select(['id', 'patient_id', 'status'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();

    if (!current) throw new NotFoundError('Lịch hẹn');
    if (!ALLOWED_TRANSITIONS[current.status].includes('cancelled')) {
      throw new ConflictError(`Lịch hẹn ${STATUS_LABELS[current.status]} không thể huỷ`);
    }

    const patient = await loadPatientKey(trx, current.patient_id);
    const dek = await loadDek(trx, patient.dek_id);

    try {
      await trx
        .updateTable('appointments')
        .set({
          status: 'cancelled',
          cancelled_at: new Date(),
          cancel_reason_enc: encryptOptionalField(reason, dek),
        })
        .where('id', '=', id)
        .execute();

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'APPOINTMENT_CANCEL',
        entityType: 'appointment',
        entityId: id,
        // Lý do huỷ có thể chứa PHI nên chỉ ghi nhận là đã có, không ghi nội dung.
        changes: { status: { old: current.status, new: 'cancelled' } },
        ipAddress: meta.ipAddress,
      });

      const row = await selectFull(id, trx);
      return toDto(row!, dek, row!);
    } finally {
      zeroize(dek);
    }
  });
}

// ── nội bộ ────────────────────────────────────────────────────────────

type Db = typeof db | Transaction<Database>;

function selectFull(id: string, trx: Db = db) {
  return trx
    .selectFrom('appointments')
    .innerJoin('patients', 'patients.id', 'appointments.patient_id')
    .innerJoin('users as doctor', 'doctor.id', 'appointments.doctor_id')
    .selectAll('appointments')
    .select([
      'patients.mrn as patient_mrn',
      'patients.first_name_enc',
      'patients.last_name_enc',
      'patients.dek_id',
      'doctor.full_name as doctor_name',
    ])
    .where('appointments.id', '=', id)
    .executeTakeFirst();
}

async function loadPatientKey(trx: Db, patientId: string) {
  const patient = await trx
    .selectFrom('patients')
    .select(['id', 'mrn', 'dek_id', 'first_name_enc', 'last_name_enc'])
    .where('id', '=', patientId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (!patient) throw new NotFoundError('Bệnh nhân');
  return patient;
}

/** Chỉ tài khoản vai trò bác sĩ mới được xếp lịch khám. */
async function assertDoctor(doctorId: string) {
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

/**
 * Ràng buộc EXCLUDE của PostgreSQL chặn hai lịch chồng giờ cùng một bác sĩ.
 * Bắt ở tầng DB thay vì kiểm tra trước bằng SELECT: hai request đồng thời đều
 * thấy lịch trống rồi cùng ghi thì mới là lỗi thật, và chỉ DB chặn được.
 */
function rethrowOverlap(err: unknown): never {
  const code = (err as { code?: string }).code;
  const constraint = (err as { constraint?: string }).constraint;
  if (code === '23P01' && constraint === 'appointments_no_doctor_overlap') {
    throw new ConflictError('Bác sĩ đã có lịch hẹn khác trùng khung giờ này');
  }
  throw err;
}

interface AppointmentRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  scheduled_start: Date;
  scheduled_end: Date;
  room: string | null;
  status: AppointmentStatus;
  reason_enc: Buffer | null;
  cancel_reason_enc: Buffer | null;
  checked_in_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  doctor_name?: string;
}

interface PatientBits {
  mrn?: string;
  patient_mrn?: string;
  first_name_enc: Buffer;
  last_name_enc: Buffer;
}

function toDto(row: AppointmentRow, dek: Buffer, patient: PatientBits): AppointmentDto {
  const first = decryptOptionalField(patient.first_name_enc, dek) ?? '';
  const last = decryptOptionalField(patient.last_name_enc, dek) ?? '';

  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: `${first} ${last}`.trim(),
    patientMrn: patient.patient_mrn ?? patient.mrn ?? '',
    doctorId: row.doctor_id,
    doctorName: row.doctor_name ?? '',
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    room: row.room,
    status: row.status,
    reason: decryptOptionalField(row.reason_enc, dek),
    cancelReason: decryptOptionalField(row.cancel_reason_enc, dek),
    checkedInAt: row.checked_in_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
  };
}
