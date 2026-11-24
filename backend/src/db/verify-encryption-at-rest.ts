import { db, closeDatabase } from './index.js';

/**
 * Kiểm tra thật (không suy đoán) rằng mọi cột `*_enc` trong DB là ciphertext,
 * không phải plaintext lọt vào do quên mã hoá ở đâu đó. Dùng cho: (1) sau mỗi
 * migration thêm cột mã hoá mới, (2) bước xác minh trước khi tin một bản sao
 * lưu là an toàn để lưu trữ/chuyển đi.
 *
 * Nguyên lý: AES-256-GCM sinh ra 12 byte IV + 16 byte auth tag hoàn toàn ngẫu
 * nhiên ở đầu mỗi ciphertext. Xác suất 28 byte ngẫu nhiên liên tiếp TÌNH CỜ
 * tạo thành chuỗi UTF-8 hợp lệ là cực nhỏ (UTF-8 có cấu trúc continuation-byte
 * chặt, byte ngẫu nhiên vi phạm cấu trúc đó gần như chắc chắn). Nên: ép decode
 * UTF-8 mà THÀNH CÔNG mới là điều đáng ngờ — ngược với trực giác thông thường.
 */
const TARGETS: Array<{ table: string; idColumn: string; columns: string[] }> = [
  {
    table: 'patients',
    idColumn: 'id',
    columns: ['first_name_enc', 'last_name_enc', 'dob_enc', 'email_enc', 'phone_enc', 'address_enc', 'insurance_id_enc'],
  },
  { table: 'appointments', idColumn: 'id', columns: ['reason_enc', 'cancel_reason_enc'] },
  { table: 'medical_records', idColumn: 'id', columns: ['title_enc', 'content_enc', 'icd10_code_enc'] },
  { table: 'medical_record_versions', idColumn: 'id', columns: ['title_enc', 'content_enc', 'icd10_code_enc'] },
  { table: 'prescriptions', idColumn: 'id', columns: ['instructions_enc'] },
  {
    table: 'lab_results',
    idColumn: 'id',
    columns: ['test_name_enc', 'loinc_code_enc', 'result_value_enc', 'unit_enc', 'reference_range_enc', 'abnormal_flag_enc'],
  },
  { table: 'documents', idColumn: 'id', columns: ['file_name_enc'] },
  { table: 'mfa_secrets', idColumn: 'user_id', columns: ['secret_enc'] },
];

function decodesCleanlyAsUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let total = 0;
  const findings: string[] = [];

  for (const { table, idColumn, columns } of TARGETS) {
    for (const column of columns) {
      const rows = await db
        .selectFrom(table as never)
        .select([idColumn as never, column as never])
        .where(column as never, 'is not', null)
        .execute();

      for (const row of rows as unknown as Array<Record<string, unknown>>) {
        const value = row[column];
        if (!Buffer.isBuffer(value)) continue;
        total++;
        // Byte đầu phải là version byte 0x01 (field-encryption.ts) — nếu không,
        // đây chắc chắn không phải ciphertext do hệ thống này tạo ra.
        const hasVersionByte = value[0] === 0x01;
        const suspicious = !hasVersionByte || decodesCleanlyAsUtf8(value.subarray(1, 29));
        if (suspicious) {
          findings.push(`${table}.${column} ${idColumn}=${row[idColumn]}`);
        }
      }
    }
  }

  const result = { columnsChecked: total, suspiciousCount: findings.length, findings };
  console.log(JSON.stringify(result, null, 2));

  await closeDatabase();
  process.exit(findings.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await closeDatabase();
  process.exit(1);
});
