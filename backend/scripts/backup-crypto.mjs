import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Mã hoá file backup bằng AES-256-GCM. Dùng layout GIỐNG field-encryption.ts
 * để nhất quán: [version:1][iv:12][authTag:16][ciphertext].
 *
 * KHOÁ RIÊNG (BACKUP_ENCRYPTION_KEY), KHÔNG dùng KEK: mất khoá backup không
 * ảnh hưởng dữ liệu sống, và ngược lại. Backup mã hoá là bắt buộc trước khi
 * đưa off-site — dump chứa search hash, tên nhân viên, MRN, IP audit ở dạng
 * thô (dù cột PHI lõi đã là ciphertext), nên file dump vẫn là dữ liệu nhạy cảm.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION_BYTE = 0x01;

export function loadBackupKey() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`BACKUP_ENCRYPTION_KEY phải là 32 byte sau khi decode base64 (hiện ${key.length})`);
  }
  return key;
}

export function encryptBuffer(plaintext, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION_BYTE]), iv, cipher.getAuthTag(), body]);
}

export function decryptBuffer(ciphertext, key) {
  if (ciphertext[0] !== VERSION_BYTE) throw new Error(`Phiên bản backup không hỗ trợ: ${ciphertext[0]}`);
  if (ciphertext.length < 1 + IV_BYTES + TAG_BYTES) throw new Error('File backup mã hoá không hợp lệ');
  const iv = ciphertext.subarray(1, 1 + IV_BYTES);
  const tag = ciphertext.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
}

/**
 * Đẩy file lên đích S3-compatible (S3 thật hoặc MinIO tự host trên VPS) nếu đã
 * cấu hình BACKUP_S3_BUCKET. Trả về key đã upload, hoặc null nếu không cấu hình.
 */
export async function uploadOffsite(filePath, fileName) {
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) return null;

  const { readFile } = await import('node:fs/promises');
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

  const config = { region: process.env.BACKUP_S3_REGION ?? 'us-east-1' };
  if (process.env.BACKUP_S3_ENDPOINT) {
    config.endpoint = process.env.BACKUP_S3_ENDPOINT;
    config.forcePathStyle = process.env.BACKUP_S3_FORCE_PATH_STYLE === 'true';
  }
  if (process.env.BACKUP_S3_ACCESS_KEY_ID) {
    config.credentials = {
      accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY,
    };
  }

  const client = new S3Client(config);
  const key = `${process.env.BACKUP_S3_PREFIX ?? 'backups/'}${fileName}`;
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: await readFile(filePath), ContentType: 'application/octet-stream' }),
  );
  return key;
}
