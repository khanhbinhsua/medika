import { createHash, randomUUID } from 'node:crypto';
import { db } from '../../db/index.js';
import { writeAuditLog, writePhiAccessLog, writePhiAccessLogs } from '../../audit/audit-logger.js';
import { NotFoundError } from '../../middleware/errors.js';
import {
  generateDek,
  wrapDek,
  unwrapDek,
  encryptBuffer,
  decryptBuffer,
  encryptOptionalField,
  decryptOptionalField,
  zeroize,
} from '../../crypto/field-encryption.js';
import { getStorageProvider } from '../../storage/storage-provider.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import type { UploadPhotoMeta } from './photo.schemas.js';

export interface PhotoDto {
  id: string;
  patientId: string;
  encounterId: string | null;
  category: 'before' | 'after' | 'progress';
  bodyArea: string | null;
  caption: string | null;
  takenAt: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  uploadedByName: string | null;
  createdAt: Date;
}

export interface UploadedPhoto {
  buffer: Buffer;
  mimeType: string;
}

// Mỗi ảnh mang DEK riêng (wrap bằng KMS), mã hoá tại chỗ, kiểm sha256 toàn vẹn —
// cho phép crypto-shred từng ảnh độc lập. Dùng lại đúng mô hình của documents.
export async function uploadPhoto(
  input: UploadPhotoMeta,
  file: UploadedPhoto,
  actor: Actor,
  meta: RequestMeta,
): Promise<PhotoDto> {
  return db.transaction().execute(async (trx) => {
    const patient = await trx
      .selectFrom('patients')
      .select('id')
      .where('id', '=', input.patientId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!patient) throw new NotFoundError('Bệnh nhân');

    const dek = generateDek();
    try {
      const sha256 = createHash('sha256').update(file.buffer).digest('hex');
      const storageKey = randomUUID();
      const ciphertext = encryptBuffer(file.buffer, dek);
      const { wrapped: wrappedDek } = await wrapDek(dek);

      const storage = getStorageProvider();
      await storage.write(storageKey, ciphertext);

      let row;
      try {
        row = await trx
          .insertInto('clinical_photos')
          .values({
            patient_id: input.patientId,
            encounter_id: input.encounterId ?? null,
            category: input.category,
            body_area: input.bodyArea ?? null,
            caption_enc: encryptOptionalField(input.caption, dek),
            ...(input.takenAt ? { taken_at: input.takenAt } : {}),
            mime_type: file.mimeType,
            size_bytes: String(file.buffer.length),
            storage_key: storageKey,
            file_dek_enc: wrappedDek,
            sha256,
            uploaded_by: actor.id,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        await storage.delete(storageKey).catch(() => {});
        throw err;
      }

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'PHOTO_UPLOAD',
        entityType: 'clinical_photo',
        entityId: row.id,
        ipAddress: meta.ipAddress,
      });

      await writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId: input.patientId,
        accessedBy: actor.id,
        accessType: 'create',
        fieldsAccessed: ['clinical_photo'],
        ipAddress: meta.ipAddress,
      });

      return toDto(row, decryptOptionalField(row.caption_enc, dek), actor.email);
    } finally {
      zeroize(dek);
    }
  });
}

export async function listPhotos(
  query: { patientId: string; encounterId?: string },
  actor: Actor,
  meta: RequestMeta,
): Promise<PhotoDto[]> {
  const patient = await db
    .selectFrom('patients')
    .select('id')
    .where('id', '=', query.patientId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!patient) throw new NotFoundError('Bệnh nhân');

  let base = db
    .selectFrom('clinical_photos')
    .leftJoin('users as uploader', 'uploader.id', 'clinical_photos.uploaded_by')
    .where('clinical_photos.patient_id', '=', query.patientId)
    .where('clinical_photos.deleted_at', 'is', null);
  if (query.encounterId) base = base.where('clinical_photos.encounter_id', '=', query.encounterId);

  const rows = await base
    .selectAll('clinical_photos')
    .select('uploader.full_name as uploader_name')
    .orderBy('clinical_photos.body_area', 'asc')
    .orderBy('clinical_photos.taken_at', 'asc')
    .orderBy('clinical_photos.created_at', 'asc')
    .execute();

  if (rows.length === 0) return [];

  const data: PhotoDto[] = [];
  for (const row of rows) {
    const dek = await unwrapDek(row.file_dek_enc);
    try {
      data.push(toDto(row, decryptOptionalField(row.caption_enc, dek), row.uploader_name));
    } finally {
      zeroize(dek);
    }
  }

  await db.transaction().execute((trx) =>
    writePhiAccessLogs(
      trx,
      data.map(() => ({
        requestId: meta.requestId,
        patientId: query.patientId,
        accessedBy: actor.id,
        accessType: 'view' as const,
        fieldsAccessed: ['clinical_photo'],
        ipAddress: meta.ipAddress,
      })),
    ),
  );

  return data;
}

export async function getPhotoImage(
  id: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const row = await db
    .selectFrom('clinical_photos')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('Ảnh');

  const dek = await unwrapDek(row.file_dek_enc);
  try {
    const storage = getStorageProvider();
    const ciphertext = await storage.read(row.storage_key);
    const buffer = decryptBuffer(ciphertext, dek);

    const actualSha256 = createHash('sha256').update(buffer).digest('hex');
    if (actualSha256 !== row.sha256) {
      throw new Error(`Ảnh ${id} không khớp checksum — có thể đã bị hỏng hoặc thay đổi ngoài ý muốn`);
    }

    await db.transaction().execute((trx) =>
      writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId: row.patient_id,
        accessedBy: actor.id,
        accessType: 'view',
        fieldsAccessed: ['clinical_photo'],
        ipAddress: meta.ipAddress,
      }),
    );

    return { buffer, mimeType: row.mime_type };
  } finally {
    zeroize(dek);
  }
}

export async function softDeletePhoto(id: string, actor: Actor, meta: RequestMeta): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const result = await trx
      .updateTable('clinical_photos')
      .set({ deleted_at: new Date() })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!result) throw new NotFoundError('Ảnh');

    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PHOTO_DELETE',
      entityType: 'clinical_photo',
      entityId: id,
      ipAddress: meta.ipAddress,
    });
  });
}

// ── nội bộ ────────────────────────────────────────────────────────────

interface PhotoRow {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  category: 'before' | 'after' | 'progress';
  body_area: string | null;
  taken_at: Date;
  mime_type: string;
  size_bytes: string;
  uploaded_by: string;
  created_at: Date;
}

function toDto(row: PhotoRow, caption: string | null, uploadedByName: string | null): PhotoDto {
  return {
    id: row.id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    category: row.category,
    bodyArea: row.body_area,
    caption,
    takenAt: toDateString(row.taken_at),
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    uploadedById: row.uploaded_by,
    uploadedByName,
    createdAt: row.created_at,
  };
}

/** taken_at là cột DATE — pg trả về Date (nửa đêm local) hoặc chuỗi 'YYYY-MM-DD'. */
function toDateString(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
