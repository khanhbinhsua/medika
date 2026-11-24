import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const KEY_BYTES = 32;

/**
 * KEK (Key Encryption Key) chỉ dùng để wrap/unwrap DEK.
 * Prod: AWS KMS — KEK không bao giờ rời khỏi HSM.
 * Dev:  khoá trong biến môi trường, chỉ hợp lệ cho dữ liệu giả.
 */
export interface KekProvider {
  readonly reference: string;
  wrapDek(dek: Buffer): Promise<Buffer>;
  unwrapDek(wrapped: Buffer): Promise<Buffer>;
}

class LocalKekProvider implements KekProvider {
  readonly reference = 'local:dev-kek-v1';
  readonly #key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(`KEK_LOCAL_KEY phải dài ${KEY_BYTES} byte sau khi decode base64 (hiện tại ${key.length})`);
    }
    this.#key = key;
  }

  async wrapDek(dek: Buffer): Promise<Buffer> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv);
    const body = Buffer.concat([cipher.update(dek), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  async unwrapDek(wrapped: Buffer): Promise<Buffer> {
    if (wrapped.length <= IV_BYTES + TAG_BYTES) {
      throw new Error('Wrapped DEK không hợp lệ');
    }
    const iv = wrapped.subarray(0, IV_BYTES);
    const tag = wrapped.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.#key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(wrapped.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
  }
}

/**
 * Production KEK = AWS KMS. KEK (khoá gốc) KHÔNG BAO GIỜ rời khỏi HSM của KMS —
 * mọi wrap/unwrap là một lệnh gọi KMS Encrypt/Decrypt. DEK 32 byte nằm thừa
 * trong giới hạn 4KB plaintext của KMS Encrypt.
 *
 * @aws-sdk/client-kms nạp qua dynamic import để dev (KEK_PROVIDER=local) không
 * phải cài/khởi tạo SDK. IAM role của ECS/EC2 cấp quyền kms:Encrypt/kms:Decrypt
 * lên đúng key ARN — không dùng access key tĩnh.
 */
class AwsKmsKekProvider implements KekProvider {
  readonly reference: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  #client: any;

  constructor(private readonly keyArn: string) {
    this.reference = `aws-kms:${keyArn}`;
  }

  private async client() {
    if (this.#client) return this.#client;
    const { KMSClient } = await import('@aws-sdk/client-kms');
    this.#client = new KMSClient({});
    return this.#client;
  }

  async wrapDek(dek: Buffer): Promise<Buffer> {
    const { EncryptCommand } = await import('@aws-sdk/client-kms');
    const client = await this.client();
    const out = await client.send(new EncryptCommand({ KeyId: this.keyArn, Plaintext: dek }));
    if (!out.CiphertextBlob) throw new Error('KMS Encrypt không trả CiphertextBlob');
    return Buffer.from(out.CiphertextBlob);
  }

  async unwrapDek(wrapped: Buffer): Promise<Buffer> {
    const { DecryptCommand } = await import('@aws-sdk/client-kms');
    const client = await this.client();
    // Truyền KeyId tường minh để KMS xác minh đúng khoá, không suy từ ciphertext.
    const out = await client.send(new DecryptCommand({ KeyId: this.keyArn, CiphertextBlob: wrapped }));
    if (!out.Plaintext) throw new Error('KMS Decrypt không trả Plaintext');
    return Buffer.from(out.Plaintext);
  }
}

/**
 * Cấu hình xác thực Vault:
 *  - token: token tĩnh (đơn giản, hợp cho dev/thử nghiệm)
 *  - approle: role_id + secret_id → đăng nhập lấy token NGẮN HẠN, tự làm mới.
 *    Đây là cách chuẩn cho production: app không giữ token quyền cao lâu dài,
 *    secret_id có thể xoay vòng, và token hết hạn tự động giảm thiệt hại nếu lộ.
 */
type VaultAuth = { kind: 'token'; token: string } | { kind: 'approle'; roleId: string; secretId: string };

/**
 * KEK qua HashiCorp Vault Transit engine — phương án tự host cho VPS không có
 * AWS KMS. Transit engine "encryption as a service": khoá gốc nằm TRONG Vault,
 * không bao giờ lộ ra ngoài; ta chỉ gửi DEK vào để wrap và nhận ciphertext
 * dạng `vault:v1:...` về. Đúng mô hình envelope encryption như KMS.
 *
 * Chuẩn bị Vault (production, một lần):
 *   vault secrets enable transit
 *   vault write -f transit/keys/crm-dk-kek
 *   vault auth enable approle
 *   vault policy write crm-dk-kek -   # cho phép transit/encrypt|decrypt/crm-dk-kek
 *   vault write auth/approle/role/crm-dk token_policies=crm-dk-kek token_ttl=1h
 */
class VaultKekProvider implements KekProvider {
  readonly reference: string;
  #cachedToken: string | null = null;
  #tokenExpiresAt = 0;

  constructor(
    private readonly addr: string,
    private readonly auth: VaultAuth,
    private readonly keyName: string,
  ) {
    this.reference = `vault:transit:${keyName}`;
  }

  /** Lấy token còn hạn: token tĩnh trả thẳng; AppRole thì login/làm mới khi cần. */
  private async getToken(): Promise<string> {
    if (this.auth.kind === 'token') return this.auth.token;

    // Còn hạn (trừ 60s đệm) thì dùng lại.
    if (this.#cachedToken && Date.now() < this.#tokenExpiresAt - 60_000) {
      return this.#cachedToken;
    }

    const res = await fetch(`${this.addr.replace(/\/$/, '')}/v1/auth/approle/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_id: this.auth.roleId, secret_id: this.auth.secretId }),
    });
    if (!res.ok) {
      throw new Error(`Vault AppRole login lỗi ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    }
    const json = (await res.json()) as { auth?: { client_token?: string; lease_duration?: number } };
    const clientToken = json.auth?.client_token;
    if (!clientToken) throw new Error('Vault AppRole login không trả client_token');

    this.#cachedToken = clientToken;
    // lease_duration tính bằng giây; hết hạn = now + ttl. token_ttl=0 (vô hạn) → cache 1h.
    const ttl = json.auth?.lease_duration ?? 3600;
    this.#tokenExpiresAt = Date.now() + (ttl > 0 ? ttl : 3600) * 1000;
    return clientToken;
  }

  private async call(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.addr.replace(/\/$/, '')}/v1/${path}`, {
      method: 'POST',
      headers: { 'X-Vault-Token': await this.getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Vault ${path} lỗi ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  async wrapDek(dek: Buffer): Promise<Buffer> {
    const out = await this.call(`transit/encrypt/${this.keyName}`, { plaintext: dek.toString('base64') });
    const ciphertext = (out.data as { ciphertext?: string } | undefined)?.ciphertext;
    if (!ciphertext) throw new Error('Vault encrypt không trả ciphertext');
    // Lưu chuỗi 'vault:v1:...' dưới dạng bytes để vừa cột bytea sẵn có.
    return Buffer.from(ciphertext, 'utf8');
  }

  async unwrapDek(wrapped: Buffer): Promise<Buffer> {
    const out = await this.call(`transit/decrypt/${this.keyName}`, { ciphertext: wrapped.toString('utf8') });
    const plaintext = (out.data as { plaintext?: string } | undefined)?.plaintext;
    if (!plaintext) throw new Error('Vault decrypt không trả plaintext');
    return Buffer.from(plaintext, 'base64');
  }
}

let provider: KekProvider | undefined;

export async function getKekProvider(): Promise<KekProvider> {
  if (provider) return provider;

  switch (env.KEK_PROVIDER) {
    case 'local':
      provider = new LocalKekProvider(env.KEK_LOCAL_KEY!);
      break;
    case 'aws-kms':
      provider = new AwsKmsKekProvider(env.KEK_AWS_KMS_ARN!);
      break;
    case 'vault': {
      // Ưu tiên AppRole (production) nếu có role_id + secret_id; nếu không dùng
      // token tĩnh. env.ts đã đảm bảo ít nhất một trong hai được cấu hình.
      const auth: VaultAuth =
        env.VAULT_ROLE_ID && env.VAULT_SECRET_ID
          ? { kind: 'approle', roleId: env.VAULT_ROLE_ID, secretId: env.VAULT_SECRET_ID }
          : { kind: 'token', token: env.VAULT_TOKEN! };
      provider = new VaultKekProvider(env.VAULT_ADDR!, auth, env.VAULT_TRANSIT_KEY);
      break;
    }
  }
  return provider;
}
