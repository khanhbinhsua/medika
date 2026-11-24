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
  encryptField,
  decryptField,
  zeroize,
} from '../../crypto/field-encryption.js';
import { getStorageProvider } from '../../storage/storage-provider.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';

export interface DocumentDto {
  id: string;
  patientId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  uploadedByName: string | null;
  createdAt: Date;
}

export interface UploadedFile {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

export async function uploadDocument(
  input: { patientId: string },
  file: UploadedFile,
  actor: Actor,
  meta: RequestMeta,
): Promise<DocumentDto> {
  return db.transaction().execute(async (trx) => {
    const patient = await trx
      .selectFrom('patients')
      .select('id')
      .where('id', '=', input.patientId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!patient) throw new NotFoundError('Bệnh nhân');

    // DEK RIÊNG cho từng file, wrap rồi lưu THẲNG vào documents.file_dek_enc —
    // KHÔNG qua bảng encryption_keys (khác patient/record: mỗi file tự mang
    // khoá của nó, không cần bảng trung gian, và cho phép crypto-shred từng
    // tài liệu độc lập mà không đụng tới các bảng khác).
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
          .insertInto('documents')
          .values({
            patient_id: input.patientId,
            file_name_enc: encryptField(file.originalName, dek),
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
        // Ghi DB thất bại sau khi đã ghi file vật lý — dọn lại để không rác mồ côi.
        await storage.delete(storageKey).catch(() => {});
        throw err;
      }

      await writeAuditLog(trx, {
        requestId: meta.requestId,
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'DOCUMENT_UPLOAD',
        entityType: 'document',
        entityId: row.id,
        ipAddress: meta.ipAddress,
      });

      await writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId: input.patientId,
        accessedBy: actor.id,
        accessType: 'create',
        fieldsAccessed: ['document'],
        ipAddress: meta.ipAddress,
      });

      return toDto(row, file.originalName, actor.email);
    } finally {
      zeroize(dek);
    }
  });
}

export async function listDocuments(patientId: string, actor: Actor, meta: RequestMeta): Promise<DocumentDto[]> {
  const patient = await db
    .selectFrom('patients')
    .select('id')
    .where('id', '=', patientId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!patient) throw new NotFoundError('Bệnh nhân');

  const rows = await db
    .selectFrom('documents')
    .leftJoin('users as uploader', 'uploader.id', 'documents.uploaded_by')
    .selectAll('documents')
    .select('uploader.full_name as uploader_name')
    .where('documents.patient_id', '=', patientId)
    .where('documents.deleted_at', 'is', null)
    .orderBy('documents.created_at', 'desc')
    .execute();

  if (rows.length === 0) return [];

  const data: DocumentDto[] = [];
  for (const row of rows) {
    const dek = await unwrapDek(row.file_dek_enc);
    try {
      data.push(toDto(row, decryptField(row.file_name_enc, dek), row.uploader_name));
    } finally {
      zeroize(dek);
    }
  }

  await db.transaction().execute((trx) =>
    writePhiAccessLogs(
      trx,
      data.map(() => ({
        requestId: meta.requestId,
        patientId,
        accessedBy: actor.id,
        accessType: 'view' as const,
        fieldsAccessed: ['document'],
        ipAddress: meta.ipAddress,
      })),
    ),
  );

  return data;
}

export async function downloadDocument(
  id: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const row = await db
    .selectFrom('documents')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('Tài liệu');

  const dek = await unwrapDek(row.file_dek_enc);
  try {
    const fileName = decryptField(row.file_name_enc, dek);
    const storage = getStorageProvider();
    const ciphertext = await storage.read(row.storage_key);
    const buffer = decryptBuffer(ciphertext, dek);

    // Toàn vẹn: nội dung giải mã phải khớp sha256 lưu lúc upload — phát hiện
    // file vật lý bị hỏng hoặc bị thay thế ngoài luồng ứng dụng.
    const actualSha256 = createHash('sha256').update(buffer).digest('hex');
    if (actualSha256 !== row.sha256) {
      throw new Error(`Tài liệu ${id} không khớp checksum — có thể đã bị hỏng hoặc thay đổi ngoài ý muốn`);
    }

    await db.transaction().execute((trx) =>
      writePhiAccessLog(trx, {
        requestId: meta.requestId,
        patientId: row.patient_id,
        accessedBy: actor.id,
        accessType: 'export',
        fieldsAccessed: ['document'],
        ipAddress: meta.ipAddress,
      }),
    );

    return { buffer, fileName, mimeType: row.mime_type };
  } finally {
    zeroize(dek);
  }
}

export async function softDeleteDocument(id: string, actor: Actor, meta: RequestMeta): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const result = await trx
      .updateTable('documents')
      .set({ deleted_at: new Date() })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!result) throw new NotFoundError('Tài liệu');

    await writeAuditLog(trx, {
      requestId: meta.requestId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'DOCUMENT_DELETE',
      entityType: 'document',
      entityId: id,
      ipAddress: meta.ipAddress,
    });
  });
}

// ── nội bộ ────────────────────────────────────────────────────────────

interface DocumentRow {
  id: string;
  patient_id: string;
  mime_type: string;
  size_bytes: string;
  uploaded_by: string;
  created_at: Date;
}

function toDto(row: DocumentRow, fileName: string, uploadedByName: string | null): DocumentDto {
  return {
    id: row.id,
    patientId: row.patient_id,
    fileName,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    uploadedById: row.uploaded_by,
    uploadedByName,
    createdAt: row.created_at,
  };
}
