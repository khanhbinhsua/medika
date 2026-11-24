import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { writeAuditLog, writePhiAccessLog, writePhiAccessLogs } from '../../audit/audit-logger.js';
import { NotFoundError, ConflictError } from '../../middleware/errors.js';
import { createDek, loadDek, loadDeks, destroyDek } from '../../crypto/dek-store.js';
import {
  encryptField,
  encryptOptionalField,
  decryptField,
  decryptOptionalField,
  searchHash,
  zeroize,
} from '../../crypto/field-encryption.js';
import type {
  CreatePatientInput,
  UpdatePatientInput,
  ListPatientsQuery,
  ListDeletedPatientsQuery,
} from './patient.schemas.js';

export interface Actor {
  id: string;
  email: string;
}

export interface RequestMeta {
  requestId: string;
  ipAddress?: string | undefined;
}

export interface PatientDto {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dob: string;
  gender: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  insuranceId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Các trường PHI của bệnh nhân — dùng cho phi_access_logs.fields_accessed. */
const PHI_FIELDS = ['firstName', 'lastName', 'dob', 'email', 'phone', 'address', 'insuranceId'];

export async function createPatient(
  input: CreatePatientInput,
  actor: Actor,
  meta: RequestMeta,
  // Optional external link (e.g. a DK-link patient id) written to
  // dklink_patient_id so integrations can upsert idempotently. Not exposed on
  // the public POST /patients schema — only integration code passes it.
  opts: { dklinkPatientId?: string } = {},
): Promise<PatientDto> {
  const mrn = await nextMrn();

  return db.transaction().execute(async (trx) => {
    const { dekId, dek } = await createDek(trx, 'patient');

    try {
      const row = await trx
        .insertInto('patients')
        .values({
          mrn,
          first_name_enc: encryptField(input.firstName, dek),
          last_name_enc: encryptField(input.lastName, dek),
          name_search_hash: searchHash(`${input.firstName} ${input.lastName}`),
          dob_enc: encryptField(input.dob, dek),
          gender: input.gender ?? null,
          email_enc: encryptOptionalField(input.email, dek),
          email_search_hash: input.email ? searchHash(input.email) : null,
          phone_enc: encryptOptionalField(input.phone, dek),
          phone_search_hash: input.phone ? searchHash(input.phone) : null,
          address_enc: encryptOptionalField(input.address, dek),
          insurance_id_enc: encryptOptionalField(input.insuranceId, dek),
          dek_id: dekId,
          created_by: actor.id,
          dklink_patient_id: opts.dklinkPatientId ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'PATIENT_CREATE',
        entityType: 'patient',
        entityId: row.id,
        // Chỉ ghi TÊN trường, không ghi giá trị — audit log không được chứa PHI.
        changes: Object.fromEntries(
          Object.keys(input).map((k) => [k, { old: null, new: '[SET]' }]),
        ),
        ipAddress: meta.ipAddress,
      });

      return toDto(row, dek);
    } finally {
      zeroize(dek);
    }
  });
}

export async function getPatient(id: string, actor: Actor, meta: RequestMeta): Promise<PatientDto> {
  const row = await db
    .selectFrom('patients')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (!row) throw new NotFoundError('Bệnh nhân');

  const dek = await loadDek(db, row.dek_id);
  try {
    const dto = toDto(row, dek);

    // Mọi lần giải mã PHI đều phải để lại dấu vết (§164.528 accounting of disclosures).
    await db.transaction().execute((trx) =>
      writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId: row.id,
        accessedBy: actor.id,
        accessType: 'view',
        fieldsAccessed: PHI_FIELDS,
        ipAddress: meta.ipAddress,
      }),
    );

    return dto;
  } finally {
    zeroize(dek);
  }
}

export async function listPatients(query: ListPatientsQuery, actor: Actor, meta: RequestMeta) {
  let base = db.selectFrom('patients').where('deleted_at', 'is', null);

  if (query.status) {
    base = base.where('status', '=', query.status);
  }

  // Cột đã mã hoá không LIKE được — tìm kiếm đi qua HMAC nên chỉ khớp chính xác.
  if (query.q) {
    const hash = searchHash(query.q);
    base = base.where((eb) =>
      eb.or([
        eb('name_search_hash', '=', hash),
        eb('email_search_hash', '=', hash),
        eb('phone_search_hash', '=', hash),
      ]),
    );
  }

  const { count } = await base
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();

  const rows = await base
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .execute();

  // Một lần tải DEK theo lô (1 query + unwrap song song) thay vì N lần tuần
  // tự — quan trọng ở production vì unwrap đi qua AWS KMS (network round-trip).
  const data: PatientDto[] = [];
  const deks = await loadDeks(db, rows.map((r) => r.dek_id));
  try {
    for (const row of rows) {
      data.push(toDto(row, deks.get(row.dek_id)!));
    }
  } finally {
    for (const dek of deks.values()) zeroize(dek);
  }

  if (data.length > 0) {
    await db.transaction().execute((trx) =>
      writePhiAccessLogs(
        trx,
        data.map((p) => ({
          requestId: meta.requestId,
          patientId: p.id,
          accessedBy: actor.id,
          accessType: 'view' as const,
          fieldsAccessed: ['firstName', 'lastName', 'dob'],
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

export async function updatePatient(
  id: string,
  input: UpdatePatientInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<PatientDto> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('patients')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();

    if (!row) throw new NotFoundError('Bệnh nhân');

    const dek = await loadDek(trx, row.dek_id);
    try {
      const current = toDto(row, dek);
      const patch: Record<string, unknown> = {};

      if (input.firstName !== undefined || input.lastName !== undefined) {
        const firstName = input.firstName ?? current.firstName;
        const lastName = input.lastName ?? current.lastName;
        patch.first_name_enc = encryptField(firstName, dek);
        patch.last_name_enc = encryptField(lastName, dek);
        patch.name_search_hash = searchHash(`${firstName} ${lastName}`);
      }
      if (input.dob !== undefined) patch.dob_enc = encryptField(input.dob, dek);
      if (input.gender !== undefined) patch.gender = input.gender;
      if (input.email !== undefined) {
        patch.email_enc = encryptOptionalField(input.email, dek);
        patch.email_search_hash = input.email ? searchHash(input.email) : null;
      }
      if (input.phone !== undefined) {
        patch.phone_enc = encryptOptionalField(input.phone, dek);
        patch.phone_search_hash = input.phone ? searchHash(input.phone) : null;
      }
      if (input.address !== undefined) patch.address_enc = encryptOptionalField(input.address, dek);
      if (input.insuranceId !== undefined) {
        patch.insurance_id_enc = encryptOptionalField(input.insuranceId, dek);
      }

      const updated = await trx
        .updateTable('patients')
        .set(patch)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'PATIENT_UPDATE',
        entityType: 'patient',
        entityId: id,
        changes: Object.fromEntries(
          Object.keys(input).map((k) => [k, { old: '[REDACTED]', new: '[REDACTED]' }]),
        ),
        ipAddress: meta.ipAddress,
      });

      await writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId: id,
        accessedBy: actor.id,
        accessType: 'modify',
        fieldsAccessed: Object.keys(input),
        ipAddress: meta.ipAddress,
      });

      return toDto(updated, dek);
    } finally {
      zeroize(dek);
    }
  });
}

export async function softDeletePatient(id: string, actor: Actor, meta: RequestMeta): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const result = await trx
      .updateTable('patients')
      .set({ deleted_at: new Date(), status: 'inactive' })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();

    if (!result) throw new NotFoundError('Bệnh nhân');

    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PATIENT_SOFT_DELETE',
      entityType: 'patient',
      entityId: id,
      ipAddress: meta.ipAddress,
    });
  });
}

export interface DeletedPatientDto {
  id: string;
  mrn: string;
  /** Tên thật nếu chưa tiêu huỷ, hoặc placeholder nếu DEK đã bị crypto-shredded. */
  displayName: string;
  deletedAt: Date;
  purgedAt: Date | null;
  purgedByName: string | null;
  purgedReason: string | null;
  purgeEligibleAt: Date;
  isPurgeEligible: boolean;
}

/**
 * Danh sách bệnh nhân đã soft-delete — nơi duy nhất truy cập được các hồ sơ
 * này (mọi endpoint khác lọc `deleted_at IS NULL`). Phục vụ quy trình hai
 * bước: admin xem ai đã xoá, còn bao lâu thì đủ điều kiện tiêu huỷ vĩnh viễn.
 */
export async function listDeletedPatients(
  query: ListDeletedPatientsQuery,
  actor: Actor,
  meta: RequestMeta,
) {
  const base = db
    .selectFrom('patients')
    .leftJoin('users as purger', 'purger.id', 'patients.purged_by')
    .where('patients.deleted_at', 'is not', null);

  const { count } = await base
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();

  const rows = await base
    .select([
      'patients.id',
      'patients.mrn',
      'patients.first_name_enc',
      'patients.last_name_enc',
      'patients.dek_id',
      'patients.deleted_at',
      'patients.purged_at',
      'patients.purged_reason',
      'purger.full_name as purged_by_name',
    ])
    .orderBy('patients.deleted_at', 'desc')
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .execute();

  const graceMs = env.PATIENT_PURGE_GRACE_HOURS * 3600_000;

  // Chỉ tải DEK cho những hồ sơ CHƯA tiêu huỷ — DEK của hồ sơ đã purge không
  // còn tồn tại để tải, tên hiển thị dùng placeholder thay vì giải mã.
  const stillReadable = rows.filter((r) => !r.purged_at);
  const deks = await loadDeks(db, stillReadable.map((r) => r.dek_id));

  const data: DeletedPatientDto[] = [];
  try {
    for (const r of rows) {
      const purgeEligibleAt = new Date(r.deleted_at!.getTime() + graceMs);
      const displayName = r.purged_at
        ? '[Đã tiêu huỷ vĩnh viễn]'
        : `${decryptOptionalField(r.first_name_enc, deks.get(r.dek_id)!) ?? ''} ${
            decryptOptionalField(r.last_name_enc, deks.get(r.dek_id)!) ?? ''
          }`.trim();

      data.push({
        id: r.id,
        mrn: r.mrn,
        displayName,
        deletedAt: r.deleted_at!,
        purgedAt: r.purged_at,
        purgedByName: r.purged_by_name,
        purgedReason: r.purged_reason,
        purgeEligibleAt,
        isPurgeEligible: !r.purged_at && Date.now() >= purgeEligibleAt.getTime(),
      });
    }
  } finally {
    for (const dek of deks.values()) zeroize(dek);
  }

  const readable = data.filter((d) => !d.purgedAt);
  if (readable.length > 0) {
    await db.transaction().execute((trx) =>
      writePhiAccessLogs(
        trx,
        readable.map((p) => ({
          requestId: meta.requestId,
          patientId: p.id,
          accessedBy: actor.id,
          accessType: 'view' as const,
          fieldsAccessed: ['firstName', 'lastName'],
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

/**
 * Tiêu huỷ vĩnh viễn bằng crypto-shredding — HUỶ DEK của bệnh nhân, không thể
 * hoàn tác. Sau bước này mọi ciphertext dùng khoá đó (hồ sơ nhân khẩu học, lý
 * do khám mọi lịch hẹn, nội dung mọi hồ sơ bệnh án, hướng dẫn mọi đơn thuốc)
 * vĩnh viễn không giải mã được, kể cả trong bản backup cũ.
 *
 * Ba lớp bảo vệ trước một hành động không thể hoàn tác:
 *   1. Bắt buộc đã soft-delete trước (CHECK constraint ở DB cũng chặn lại).
 *   2. Thời gian ân hạn tối thiểu kể từ lúc soft-delete (PATIENT_PURGE_GRACE_HOURS).
 *   3. Bắt buộc nêu lý do — lưu cùng bản ghi, không chỉ trong audit log.
 */
export async function purgePatient(
  id: string,
  reason: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const patient = await trx
      .selectFrom('patients')
      .select(['id', 'dek_id', 'deleted_at', 'purged_at'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();

    if (!patient) throw new NotFoundError('Bệnh nhân');
    if (patient.purged_at) throw new ConflictError('Hồ sơ đã bị tiêu huỷ vĩnh viễn trước đó');
    if (!patient.deleted_at) {
      throw new ConflictError('Phải xoá (soft-delete) hồ sơ trước khi tiêu huỷ vĩnh viễn');
    }

    const graceMs = env.PATIENT_PURGE_GRACE_HOURS * 3600_000;
    const eligibleAt = patient.deleted_at.getTime() + graceMs;
    if (Date.now() < eligibleAt) {
      const remainingHours = Math.ceil((eligibleAt - Date.now()) / 3600_000);
      throw new ConflictError(
        `Cần chờ thêm khoảng ${remainingHours} giờ nữa mới đủ điều kiện tiêu huỷ ` +
          `(thời gian ân hạn ${env.PATIENT_PURGE_GRACE_HOURS} giờ kể từ lúc xoá)`,
      );
    }

    await destroyDek(trx, patient.dek_id);

    await trx
      .updateTable('patients')
      .set({ purged_at: new Date(), purged_by: actor.id, purged_reason: reason })
      .where('id', '=', id)
      .execute();

    // Mức nghiêm trọng cao nhất trong toàn hệ thống: hành động không thể hoàn
    // tác, phải để lại dấu vết đầy đủ nhất có thể trong nhật ký kiểm toán.
    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PATIENT_PURGE',
      entityType: 'patient',
      entityId: id,
      reason,
      ipAddress: meta.ipAddress,
    });
  });
}

// ── nội bộ ────────────────────────────────────────────────────────────

interface PatientRow {
  id: string;
  mrn: string;
  first_name_enc: Buffer;
  last_name_enc: Buffer;
  dob_enc: Buffer;
  gender: string | null;
  email_enc: Buffer | null;
  phone_enc: Buffer | null;
  address_enc: Buffer | null;
  insurance_id_enc: Buffer | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function toDto(row: PatientRow, dek: Buffer): PatientDto {
  return {
    id: row.id,
    mrn: row.mrn,
    firstName: decryptField(row.first_name_enc, dek),
    lastName: decryptField(row.last_name_enc, dek),
    dob: decryptField(row.dob_enc, dek),
    gender: row.gender,
    email: decryptOptionalField(row.email_enc, dek),
    phone: decryptOptionalField(row.phone_enc, dek),
    address: decryptOptionalField(row.address_enc, dek),
    insuranceId: decryptOptionalField(row.insurance_id_enc, dek),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** MRN dạng BN-YYYY-NNNNNN, tăng dần theo năm. */
async function nextMrn(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `BN-${year}-`;

  const last = await db
    .selectFrom('patients')
    .select('mrn')
    .where('mrn', 'like', `${prefix}%`)
    .orderBy('mrn', 'desc')
    .limit(1)
    .executeTakeFirst();

  const nextSeq = last ? Number(last.mrn.slice(prefix.length)) + 1 : 1;
  if (Number.isNaN(nextSeq)) throw new ConflictError('Không sinh được mã hồ sơ bệnh nhân');

  return `${prefix}${String(nextSeq).padStart(6, '0')}`;
}
