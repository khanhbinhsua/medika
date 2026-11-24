import { db } from '../../db/index.js';
import { writeAuditLog, writePhiAccessLogs } from '../../audit/audit-logger.js';
import { NotFoundError, ValidationError, ConflictError } from '../../middleware/errors.js';
import { loadDek } from '../../crypto/dek-store.js';
import { encryptOptionalField, decryptOptionalField, searchHash, zeroize } from '../../crypto/field-encryption.js';
import { createPatient } from '../patient/patient.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import type { CreateBookingInput, ConfirmBookingInput } from './booking.schemas.js';
import { SLOT_MINUTES } from './booking.schemas.js';

// Sản phẩm phục vụ VN → tính khung giờ theo giờ Việt Nam (UTC+7).
const VN_OFFSET = '+07:00';
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function rangesForDate(openingHours: Record<string, unknown>, dateStr: string): [string, string][] {
  // getDay trên mốc giữa trưa VN để không lệch ngày do timezone server.
  const dow = new Date(`${dateStr}T12:00:00${VN_OFFSET}`).getUTCDay();
  const key = WEEKDAYS[dow]!;
  const raw = openingHours?.[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((r) => Array.isArray(r) && r.length === 2) as [string, string][];
}

function* slotStarts(dateStr: string, ranges: [string, string][]): Generator<Date> {
  for (const [start, end] of ranges) {
    const s = new Date(`${dateStr}T${start}:00${VN_OFFSET}`);
    const e = new Date(`${dateStr}T${end}:00${VN_OFFSET}`);
    for (let t = s.getTime(); t + SLOT_MINUTES * 60_000 <= e.getTime(); t += SLOT_MINUTES * 60_000) {
      yield new Date(t);
    }
  }
}

async function loadBranch(branchId: string) {
  const b = await db
    .selectFrom('branches')
    .select(['id', 'name', 'opening_hours', 'holidays', 'slot_capacity', 'active'])
    .where('id', '=', branchId)
    .executeTakeFirst();
  if (!b || !b.active) throw new NotFoundError('Chi nhánh');
  return b;
}

export async function listPublicBranches(): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .selectFrom('branches')
    .select(['id', 'name'])
    .where('active', '=', true)
    .orderBy('is_default', 'desc')
    .orderBy('name')
    .execute();
  return rows;
}

/** Khung giờ còn chỗ của một chi nhánh trong một ngày. */
export async function availableSlots(branchId: string, dateStr: string): Promise<string[]> {
  const branch = await loadBranch(branchId);
  const holidays = Array.isArray(branch.holidays) ? (branch.holidays as string[]) : [];
  if (holidays.includes(dateStr)) return [];

  const ranges = rangesForDate(branch.opening_hours as Record<string, unknown>, dateStr);
  const capacity = branch.slot_capacity ?? 3;
  const now = Date.now();

  const slots = [...slotStarts(dateStr, ranges)].filter((d) => d.getTime() > now);
  if (slots.length === 0) return [];

  const dayStart = new Date(`${dateStr}T00:00:00${VN_OFFSET}`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);

  // Đếm lịch hẹn + yêu cầu đang chờ theo từng mốc bắt đầu (trong ngày, cùng chi nhánh).
  const appts = await db
    .selectFrom('appointments')
    .select('scheduled_start')
    .where('branch_id', '=', branchId)
    .where('scheduled_start', '>=', dayStart)
    .where('scheduled_start', '<', dayEnd)
    .where('status', 'not in', ['cancelled', 'no_show'])
    .execute();
  const pending = await db
    .selectFrom('booking_requests')
    .select('requested_start')
    .where('branch_id', '=', branchId)
    .where('status', '=', 'pending')
    .where('requested_start', '>=', dayStart)
    .where('requested_start', '<', dayEnd)
    .execute();

  const taken = new Map<number, number>();
  for (const a of appts) taken.set(new Date(a.scheduled_start).getTime(), (taken.get(new Date(a.scheduled_start).getTime()) ?? 0) + 1);
  for (const p of pending) taken.set(new Date(p.requested_start).getTime(), (taken.get(new Date(p.requested_start).getTime()) ?? 0) + 1);

  return slots.filter((d) => (taken.get(d.getTime()) ?? 0) < capacity).map((d) => d.toISOString());
}

export async function createBookingRequest(input: CreateBookingInput): Promise<{ id: string }> {
  const start = new Date(input.start);
  const dateStr = new Date(start.getTime() + 7 * 3600_000).toISOString().slice(0, 10); // ngày theo giờ VN
  const open = await availableSlots(input.branchId, dateStr);
  if (!open.includes(start.toISOString())) {
    throw new ConflictError('Khung giờ không còn trống hoặc không hợp lệ — vui lòng chọn lại');
  }
  const row = await db
    .insertInto('booking_requests')
    .values({
      branch_id: input.branchId,
      requested_start: start,
      requested_end: new Date(start.getTime() + SLOT_MINUTES * 60_000),
      full_name: input.fullName,
      phone: input.phone,
      note: input.note ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id };
}

// ── Nhân sự ──────────────────────────────────────────────────────────────────
export interface BookingDto {
  id: string;
  branchId: string;
  branchName: string;
  requestedStart: string;
  fullName: string;
  phone: string;
  note: string | null;
  status: string;
  createdAt: string;
}

export async function listPending(): Promise<BookingDto[]> {
  const rows = await db
    .selectFrom('booking_requests as br')
    .innerJoin('branches as b', 'b.id', 'br.branch_id')
    .select([
      'br.id as id', 'br.branch_id as branchId', 'b.name as branchName',
      'br.requested_start as requestedStart', 'br.full_name as fullName',
      'br.phone as phone', 'br.note as note', 'br.status as status', 'br.created_at as createdAt',
    ])
    .where('br.status', '=', 'pending')
    .orderBy('br.requested_start')
    .execute();
  return rows.map((r) => ({
    ...r,
    requestedStart: new Date(r.requestedStart).toISOString(),
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}

/** Gợi ý bệnh nhân đã có khớp theo số điện thoại (để lễ tân liên kết). */
export async function matchPatientsByPhone(
  phone: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<{ id: string; mrn: string; name: string }[]> {
  const hash = searchHash(phone);
  const rows = await db
    .selectFrom('patients')
    .select(['id', 'mrn', 'first_name_enc', 'last_name_enc', 'dek_id'])
    .where('phone_search_hash', '=', hash)
    .where('deleted_at', 'is', null)
    .limit(10)
    .execute();
  if (rows.length === 0) return [];
  const out: { id: string; mrn: string; name: string }[] = [];
  for (const r of rows) {
    const dek = await loadDek(db, r.dek_id);
    try {
      const name = `${decryptOptionalField(r.first_name_enc, dek) ?? ''} ${decryptOptionalField(r.last_name_enc, dek) ?? ''}`.trim();
      out.push({ id: r.id, mrn: r.mrn, name: name || r.mrn });
    } finally {
      zeroize(dek);
    }
  }
  await db.transaction().execute((trx) =>
    writePhiAccessLogs(
      trx,
      out.map((p) => ({
        requestId: meta.requestId,
        patientId: p.id,
        accessedBy: actor.id,
        accessType: 'view' as const,
        fieldsAccessed: ['firstName', 'lastName'],
        purpose: 'booking_match',
        ipAddress: meta.ipAddress,
      })),
    ),
  );
  return out;
}

export async function confirmBooking(
  id: string,
  input: ConfirmBookingInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<{ appointmentId: string; patientId: string }> {
  const booking = await db.selectFrom('booking_requests').selectAll().where('id', '=', id).executeTakeFirst();
  if (!booking) throw new NotFoundError('Yêu cầu đặt lịch');
  if (booking.status !== 'pending') throw new ConflictError('Yêu cầu đã được xử lý');

  const doctor = await db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select('users.id')
    .where('users.id', '=', input.doctorId)
    .where('roles.name', '=', 'doctor')
    .executeTakeFirst();
  if (!doctor) throw new ValidationError('Bác sĩ không hợp lệ');

  // Bệnh nhân: liên kết có sẵn hoặc tạo mới (tái dùng mã hoá + MRN + audit).
  let patientId = input.patientId;
  if (!patientId) {
    const np = input.newPatient!;
    const created = await createPatient(
      { firstName: np.firstName, lastName: np.lastName, dob: np.dob, gender: np.gender, phone: booking.phone },
      actor,
      meta,
    );
    patientId = created.id;
  }

  const patient = await db.selectFrom('patients').select('dek_id').where('id', '=', patientId).executeTakeFirst();
  if (!patient) throw new NotFoundError('Bệnh nhân');

  const dek = await loadDek(db, patient.dek_id);
  try {
    return await db.transaction().execute(async (trx) => {
      const appt = await trx
        .insertInto('appointments')
        .values({
          patient_id: patientId!,
          doctor_id: input.doctorId,
          branch_id: booking.branch_id,
          source: 'online',
          status: 'confirmed',
          scheduled_start: new Date(booking.requested_start),
          scheduled_end: new Date(booking.requested_end),
          reason_enc: encryptOptionalField(booking.note ?? undefined, dek),
          created_by: actor.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('booking_requests')
        .set({ status: 'confirmed', confirmed_appointment_id: appt.id, handled_by: actor.id, handled_at: new Date() })
        .where('id', '=', id)
        .execute();

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'BOOKING_CONFIRM',
        entityType: 'booking_request',
        entityId: id,
        reason: `appointment ${appt.id}`,
        ipAddress: meta.ipAddress,
      });
      return { appointmentId: appt.id, patientId: patientId! };
    });
  } finally {
    zeroize(dek);
  }
}

export async function rejectBooking(id: string, reason: string | undefined, actor: Actor, meta: RequestMeta): Promise<void> {
  const booking = await db.selectFrom('booking_requests').select(['id', 'status']).where('id', '=', id).executeTakeFirst();
  if (!booking) throw new NotFoundError('Yêu cầu đặt lịch');
  if (booking.status !== 'pending') throw new ConflictError('Yêu cầu đã được xử lý');

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('booking_requests')
      .set({ status: 'rejected', reject_reason: reason ?? null, handled_by: actor.id, handled_at: new Date() })
      .where('id', '=', id)
      .execute();
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'BOOKING_REJECT',
      entityType: 'booking_request',
      entityId: id,
      ipAddress: meta.ipAddress,
    });
  });
}
