import 'dotenv/config';
import { execFileSync, spawn } from 'node:child_process';
import { readdirSync, statSync, createReadStream, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackupKey, decryptBuffer } from './backup-crypto.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.resolve(__dirname, '..', 'backups');
const CONTAINER = process.env.DOCKER_PG_CONTAINER ?? 'crm-dk-postgres';
const PG_USER = process.env.POSTGRES_USER ?? 'crm_app';
const PRIMARY_DB = process.env.POSTGRES_DB ?? 'crm_dk';

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

function latestBackupFile() {
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.dump') || f.endsWith('.dump.enc'))
    .map((f) => ({ name: f, path: path.join(BACKUP_DIR, f), mtime: statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) throw new Error('Không có bản sao lưu nào trong backups/ — chạy npm run backup trước');
  return files[0].path;
}

/**
 * File .enc là backup đã mã hoá — giải mã ra file tạm để pg_restore đọc, và
 * DỌN file tạm plaintext sau khi xong (không để dump giải mã nằm lại trên đĩa).
 * Trả về { file, cleanup }.
 */
function prepareDumpFile(file) {
  if (!file.endsWith('.enc')) return { file, cleanup: () => {} };
  const key = loadBackupKey();
  if (!key) throw new Error('File backup đã mã hoá nhưng thiếu BACKUP_ENCRYPTION_KEY để giải mã');
  const tmp = file.replace(/\.enc$/, '') + '.tmp-restore';
  writeFileSync(tmp, decryptBuffer(readFileSync(file), key));
  return { file: tmp, cleanup: () => { try { unlinkSync(tmp); } catch { /* đã xoá */ } } };
}

function dbExists(name) {
  const out = execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', PG_USER, '-d', PRIMARY_DB, '-t', '-A', '-c',
    `SELECT 1 FROM pg_database WHERE datname = '${name}'`], { encoding: 'utf8' }).trim();
  return out === '1';
}

function createDatabase(name) {
  execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', PG_USER, '-d', PRIMARY_DB, '-c', `CREATE DATABASE ${name}`], {
    stdio: 'inherit',
  });
}

function dropDatabase(name) {
  execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', PG_USER, '-d', PRIMARY_DB, '-c', `DROP DATABASE IF EXISTS ${name}`], {
    stdio: 'inherit',
  });
}

function restoreInto(dumpFile, targetDb) {
  return new Promise((resolve, reject) => {
    const input = createReadStream(dumpFile);
    const proc = spawn('docker', ['exec', '-i', CONTAINER, 'pg_restore', '-U', PG_USER, '-d', targetDb, '--no-owner', '--role', PG_USER], {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    input.pipe(proc.stdin);
    proc.on('error', reject);
    // pg_restore thường thoát mã khác 0 vì cảnh báo vô hại (thứ tự khoá ngoại,
    // đối tượng đã tồn tại...) — kiểm tra dữ liệu thật ở bước verify sau đó,
    // không dựa vào exit code của riêng lệnh này.
    proc.on('close', () => resolve());
  });
}

async function main() {
  const file = argValue('--file') ?? latestBackupFile();
  const target = argValue('--target');
  const forcePrimary = process.argv.includes('--force-overwrite-primary');

  if (!target) {
    console.error('Bắt buộc chỉ định --target <ten_database>. KHÔNG có giá trị mặc định — đây là điểm chặn');
    console.error('có chủ đích để tránh vô tình phục hồi đè lên database đang chạy.');
    process.exit(1);
  }

  if (target === PRIMARY_DB) {
    const confirmed = forcePrimary && process.env.CONFIRM_OVERWRITE === PRIMARY_DB;
    if (!confirmed) {
      console.error(`Từ chối phục hồi đè lên "${PRIMARY_DB}" — đây là database chính đang chạy.`);
      console.error(`Nếu THỰC SỰ muốn ghi đè (ví dụ diễn tập disaster recovery), chạy lại với:`);
      console.error(`  --force-overwrite-primary  VÀ  CONFIRM_OVERWRITE=${PRIMARY_DB}`);
      process.exit(1);
    }
    console.warn(`XÁC NHẬN: sẽ XOÁ VÀ GHI ĐÈ "${PRIMARY_DB}". Có 5 giây để Ctrl+C huỷ...`);
    await new Promise((r) => setTimeout(r, 5000));
    dropDatabase(target);
    createDatabase(target);
  } else if (dbExists(target)) {
    console.error(`Database "${target}" đã tồn tại. Xoá thủ công trước nếu muốn phục hồi đè lên nó`);
    console.error(`(script không tự xoá database KHÔNG PHẢI database chính, để tránh xoá nhầm dữ liệu khác).`);
    process.exit(1);
  } else {
    createDatabase(target);
  }

  // Nếu file mã hoá (.enc): giải mã ra file tạm, dọn sau khi phục hồi xong.
  const { file: dumpFile, cleanup } = prepareDumpFile(file);
  if (dumpFile !== file) console.log(`Đã giải mã ${path.basename(file)} → file tạm để phục hồi`);

  console.log(`Đang phục hồi ${file} → database "${target}"...`);
  const t0 = Date.now();
  try {
    await restoreInto(dumpFile, target);
  } finally {
    cleanup(); // xoá dump plaintext tạm dù thành công hay lỗi
  }
  console.log(`Xong sau ${((Date.now() - t0) / 1000).toFixed(1)}s. Đang kiểm tra dữ liệu...`);

  execFileSync('npx', ['tsx', 'src/db/verify-restored-db.ts', target], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
    shell: true,
  });

  console.log(`\nPhục hồi thành công. Database "${target}" sẵn sàng dùng.`);
}

main().catch((err) => {
  console.error('Phục hồi thất bại:', err.message);
  process.exit(1);
});
