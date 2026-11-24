import 'dotenv/config';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackupKey, encryptBuffer, uploadOffsite } from './backup-crypto.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.resolve(__dirname, '..', 'backups');
const CONTAINER = process.env.DOCKER_PG_CONTAINER ?? 'crm-dk-postgres';
const PG_USER = process.env.POSTGRES_USER ?? 'crm_app';
const PG_DB = process.env.POSTGRES_DB ?? 'crm_dk';
const KEEP = Number(process.argv.find((a) => a.startsWith('--keep='))?.split('=')[1] ?? 7);

/**
 * Sao lưu bằng `pg_dump -Fc` (custom format): nén sẵn, cho phép pg_restore
 * chọn lọc bảng/schema, và là định dạng khuyến nghị chính thức của PostgreSQL
 * cho backup logic (khác với dump SQL thuần dễ vỡ khi thứ tự câu lệnh sai).
 *
 * KHÔNG cần mã hoá thêm ở tầng file: mọi cột PHI đã là ciphertext AES-256-GCM
 * từ trước khi ra khỏi DB — file dump chỉ chứa ciphertext + DEK đã wrap (vô
 * dụng nếu không có KEK, và KEK không bao giờ nằm trong DB). Script này tự
 * xác minh điều đó ở bước kiểm tra cuối, không chỉ giả định.
 */
function pgDump(outFile) {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(outFile);
    const proc = spawn('docker', ['exec', CONTAINER, 'pg_dump', '-U', PG_USER, '-d', PG_DB, '-Fc'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    proc.stdout.pipe(out);
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump thoát với mã ${code}`))));
  });
}

function rotateOldBackups() {
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.dump') || f.endsWith('.dump.enc'))
    .map((f) => ({ name: f, path: path.join(BACKUP_DIR, f), mtime: statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const toDelete = files.slice(KEEP);
  for (const f of toDelete) {
    unlinkSync(f.path);
    console.log(`  đã xoá bản cũ: ${f.name}`);
  }
  return { kept: files.length - toDelete.length, deleted: toDelete.length };
}

/**
 * Không tin "chắc là an toàn" — tự kiểm tra thật trên chính DB nguồn (không
 * phải grep chuỗi tên trên file dump: `-Fc` nén từng bảng nên grep luôn trả
 * về 0 bất kể có rò rỉ hay không — một phép kiểm tra như vậy tệ hơn không có
 * gì, vì tạo cảm giác an toàn giả). Dùng verify-encryption-at-rest.ts: ép mọi
 * cột `*_enc` decode UTF-8, ciphertext AES-GCM thật sẽ luôn lỗi; decode thành
 * công mới là dấu hiệu đáng ngờ.
 */
function assertNoPlaintextLeak() {
  const output = execFileSync('npx', ['tsx', 'src/db/verify-encryption-at-rest.ts'], {
    encoding: 'utf8',
    cwd: path.resolve(__dirname, '..'),
    shell: true,
  });
  const result = JSON.parse(output.slice(output.indexOf('{')));
  console.log(`  đã kiểm tra ${result.columnsChecked} cột mã hoá`);
  return result.suspiciousCount === 0;
}

async function main() {
  mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(BACKUP_DIR, `${PG_DB}_${stamp}.dump`);

  console.log(`Đang sao lưu ${PG_DB} (container ${CONTAINER}) → ${outFile}`);
  const t0 = Date.now();
  await pgDump(outFile);
  const elapsedS = ((Date.now() - t0) / 1000).toFixed(1);

  const sizeBytes = statSync(outFile).size;
  console.log(`Xong sau ${elapsedS}s — ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`);

  console.log('Kiểm tra không rò rỉ PHI plaintext (trên DB nguồn, trước khi tin file dump)...');
  const clean = assertNoPlaintextLeak();
  console.log(clean ? '  OK — không tìm thấy plaintext' : '  CẢNH BÁO — nghi ngờ có plaintext, KHÔNG dùng bản backup này');
  if (!clean) process.exit(1);

  // Mã hoá file backup nếu có BACKUP_ENCRYPTION_KEY. File dump chứa search hash,
  // tên nhân viên, MRN, IP audit ở dạng thô — vẫn nhạy cảm dù cột PHI lõi đã mã
  // hoá. Bắt buộc mã hoá trước khi đưa off-site.
  const backupKey = loadBackupKey();
  let finalFile = outFile;
  if (backupKey) {
    const encFile = `${outFile}.enc`;
    writeFileSync(encFile, encryptBuffer(readFileSync(outFile), backupKey));
    unlinkSync(outFile); // xoá bản plaintext, chỉ giữ .enc
    finalFile = encFile;
    console.log(`Đã mã hoá → ${path.basename(encFile)} (AES-256-GCM), đã xoá bản plaintext`);
  } else {
    console.warn('  CẢNH BÁO: chưa đặt BACKUP_ENCRYPTION_KEY — backup KHÔNG mã hoá. Đặt khoá trước khi đưa off-site.');
  }

  // Đẩy off-site nếu cấu hình BACKUP_S3_BUCKET (S3 thật hoặc MinIO tự host).
  try {
    const key = await uploadOffsite(finalFile, path.basename(finalFile));
    if (key) console.log(`Đã đẩy off-site: ${key}`);
  } catch (err) {
    console.error(`  CẢNH BÁO: đẩy off-site thất bại — ${err.message}. Bản local vẫn giữ.`);
  }

  const { kept, deleted } = rotateOldBackups();
  console.log(`Giữ lại ${kept} bản gần nhất${deleted > 0 ? `, đã xoá ${deleted} bản cũ` : ''}.`);
}

main().catch((err) => {
  console.error('Sao lưu thất bại:', err.message);
  process.exit(1);
});
