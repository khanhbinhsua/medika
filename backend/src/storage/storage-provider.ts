import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

/**
 * Lưu trữ BLOB (nội dung file đã mã hoá). Tách khỏi KEK provider dù cùng ý
 * tưởng local/cloud — storage lưu ciphertext lớn (MB), KEK chỉ wrap khoá nhỏ
 * (32 byte). Prod: S3 — ciphertext đã tự bảo vệ nên không bắt buộc SSE-KMS
 * trên bucket, nhưng nên bật thêm cho phòng thủ theo lớp.
 */
export interface StorageProvider {
  write(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalStorageProvider implements StorageProvider {
  constructor(private readonly rootDir: string) {}

  /**
   * `storage_key` luôn là UUID do server sinh ra (không bao giờ nhận trực
   * tiếp từ client) — nhưng vẫn chặn `..`/separator làm lớp phòng thủ thứ
   * hai chống path traversal, không tin tưởng một lớp duy nhất.
   */
  private resolveSafe(key: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(key)) {
      throw new Error(`storage_key không hợp lệ: ${key}`);
    }
    return path.join(this.rootDir, key);
  }

  async write(key: string, data: Buffer): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.resolveSafe(key), data, { mode: 0o600 });
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolveSafe(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolveSafe(key)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
}

let provider: StorageProvider | undefined;

export function getStorageProvider(): StorageProvider {
  if (provider) return provider;

  if (env.STORAGE_PROVIDER === 'local') {
    provider = new LocalStorageProvider(env.STORAGE_LOCAL_DIR);
    return provider;
  }

  provider = new S3StorageProvider(env.STORAGE_S3_BUCKET!, env.STORAGE_S3_PREFIX);
  return provider;
}

/**
 * Storage tương thích S3 — dùng cho CẢ AWS S3 (cloud) LẪN MinIO (tự host trên
 * VPS). Nội dung đã là ciphertext AES-GCM trước khi tới đây; với AWS còn bật
 * thêm SSE-KMS làm lớp phòng thủ thứ hai (MinIO bỏ qua header này vô hại).
 *
 * @aws-sdk/client-s3 nạp qua dynamic import để dev không cần SDK. AWS: IAM role
 * cấp quyền. MinIO/VPS: endpoint + access key tĩnh + path-style.
 */
class S3StorageProvider implements StorageProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  #client: any;
  private readonly isAwsS3: boolean;

  constructor(
    private readonly bucket: string,
    private readonly prefix: string,
  ) {
    this.isAwsS3 = !env.STORAGE_S3_ENDPOINT; // không có endpoint tuỳ chỉnh = AWS S3
  }

  private async client() {
    if (this.#client) return this.#client;
    const { S3Client } = await import('@aws-sdk/client-s3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = { region: env.STORAGE_S3_REGION };
    if (env.STORAGE_S3_ENDPOINT) {
      config.endpoint = env.STORAGE_S3_ENDPOINT;
      config.forcePathStyle = env.STORAGE_S3_FORCE_PATH_STYLE;
    }
    if (env.STORAGE_S3_ACCESS_KEY_ID && env.STORAGE_S3_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID,
        secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY,
      };
    }
    this.#client = new S3Client(config);
    return this.#client;
  }

  private objectKey(key: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(key)) throw new Error(`storage_key không hợp lệ: ${key}`);
    return `${this.prefix}${key}`;
  }

  async write(key: string, data: Buffer): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: data,
        // SSE-KMS chỉ áp cho AWS S3 thật; MinIO không có KMS nên bỏ header.
        ...(this.isAwsS3 ? { ServerSideEncryption: 'aws:kms' as const } : {}),
        ContentType: 'application/octet-stream',
      }),
    );
  }

  async read(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    const out = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
    const bytes = await out.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
  }
}
