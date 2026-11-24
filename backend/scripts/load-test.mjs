import { authenticator } from 'otplib';

const BASE = 'http://localhost:4100/api';
const VIRTUAL_USERS = 20;
const DURATION_MS = 20_000;
const PWD = 'DevPassword123!';

// Chỉ có 5 tài khoản dev — 20 người dùng ảo chia nhau dùng theo vòng, đúng
// với thực tế: một phòng khám 20 người không có nghĩa 20 tài khoản phân biệt
// đang gõ API đồng thời, mà là 20 PHIÊN đang hoạt động song song. Cái cần đo
// là khả năng chịu tải ĐỌC đồng thời — nơi tốn CPU nhất trong kiến trúc này:
// mỗi dòng trả về phải unwrap DEK riêng rồi giải mã AES-GCM riêng, không phải
// một phép giải mã dùng chung cho cả trang.
//
// Workload theo ĐÚNG quyền hạn từng vai trò (không phải mọi tài khoản đều có
// patient:read — kiểm toán viên chỉ có audit:read theo đúng thiết kế RBAC).
// Gọi nhầm endpoint ngoài quyền sẽ ăn 403 hàng loạt và làm sai lệch kết quả đo.
const ACCOUNTS = [
  { email: 'admin@crm-dk.local', scenario: 'clinical' },
  { email: 'bacsi@crm-dk.local', scenario: 'clinical' },
  { email: 'yta@crm-dk.local', scenario: 'clinical' },
  { email: 'letan@crm-dk.local', scenario: 'clinical' },
  { email: 'kiemtoan@crm-dk.local', scenario: 'audit' },
];

async function req(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const t0 = performance.now();
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ms = performance.now() - t0;
  await res.text().catch(() => {});
  return { status: res.status, ms };
}

/**
 * Load test không biết secret TOTP thật của người dùng (không lưu ở đâu cả
 * sau bước đăng ký) — dùng mã khôi phục thay thế đòi hỏi phá 10 mã dùng một
 * lần, không hợp cho việc chạy lặp lại nhiều lần. Thay vào đó: gỡ MFA rồi tự
 * đăng ký lại một secret MỚI ngay trước khi đo, và giữ secret đó trong bộ nhớ
 * script suốt phiên chạy.
 */
async function loginWithFreshMfa(email) {
  const first = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PWD }),
  }).then((r) => r.json());

  if (!first.mfaEnrollmentRequired) {
    throw new Error(`${email}: cần chạy "npm run dev:reset-mfa" trước khi load test`);
  }

  const enrollmentToken = first.enrollmentToken;
  const start = await fetch(`${BASE}/auth/mfa/enroll/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollmentToken }),
  }).then((r) => r.json());

  const secret = new URL(start.otpauthUrl).searchParams.get('secret');
  const code = authenticator.generate(secret);
  const confirm = await fetch(`${BASE}/auth/mfa/enroll/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollmentToken, code }),
  }).then((r) => r.json());

  if (!confirm.accessToken) throw new Error(`${email}: đăng ký MFA thất bại: ${JSON.stringify(confirm)}`);
  return confirm.accessToken;
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

async function main() {
  console.log(`Chuẩn bị: gỡ MFA và đăng ký lại ${ACCOUNTS.length} tài khoản dev...`);
  const { execFileSync } = await import('node:child_process');
  execFileSync('npx', ['tsx', 'src/db/reset-dev-mfa.ts'], { stdio: 'ignore', shell: true });

  const sessions = [];
  for (const account of ACCOUNTS) {
    const token = await loginWithFreshMfa(account.email);
    sessions.push({ ...account, token });
    console.log(`  đăng nhập xong: ${account.email} (${account.scenario})`);
  }

  console.log(`\nBắt đầu load test: ${VIRTUAL_USERS} người dùng ảo, ${DURATION_MS / 1000}s`);

  const results = [];
  const endAt = Date.now() + DURATION_MS;

  async function virtualUser(index) {
    const { token, scenario } = sessions[index % sessions.length];
    let requestCount = 0;

    while (Date.now() < endAt) {
      if (scenario === 'clinical') {
        // Luồng dùng thật của lễ tân/y tá/bác sĩ: xem danh sách bệnh nhân rồi lịch hẹn.
        const list = await req('GET', '/patients?pageSize=20', { token });
        results.push({ path: 'GET /patients', ...list });
        requestCount++;

        const appts = await req('GET', '/appointments?pageSize=20', { token });
        results.push({ path: 'GET /appointments', ...appts });
        requestCount++;
      } else {
        // Luồng dùng thật của kiểm toán viên: không đụng PHI, chỉ xem nhật ký.
        const logs = await req('GET', '/audit/logs?pageSize=50', { token });
        results.push({ path: 'GET /audit/logs', ...logs });
        requestCount++;
      }
    }
    return requestCount;
  }

  const t0 = performance.now();
  const perUserCounts = await Promise.all(
    Array.from({ length: VIRTUAL_USERS }, (_, i) => virtualUser(i)),
  );
  const elapsedS = (performance.now() - t0) / 1000;

  const totalRequests = results.length;
  const errors = results.filter((r) => r.status >= 400);
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`KẾT QUẢ LOAD TEST`);
  console.log('='.repeat(50));
  console.log(`Người dùng ảo đồng thời : ${VIRTUAL_USERS}`);
  console.log(`Thời gian chạy thực tế  : ${elapsedS.toFixed(1)}s`);
  console.log(`Tổng số request         : ${totalRequests}`);
  console.log(`Throughput              : ${(totalRequests / elapsedS).toFixed(1)} req/s`);
  console.log(`Lỗi (status >= 400)     : ${errors.length} (${((errors.length / totalRequests) * 100).toFixed(2)}%)`);
  console.log(`Request/người dùng ảo   : ${perUserCounts.join(', ')}`);
  console.log(`\nĐộ trễ (ms):`);
  console.log(`  p50  : ${percentile(latencies, 50).toFixed(0)}`);
  console.log(`  p90  : ${percentile(latencies, 90).toFixed(0)}`);
  console.log(`  p95  : ${percentile(latencies, 95).toFixed(0)}`);
  console.log(`  p99  : ${percentile(latencies, 99).toFixed(0)}`);
  console.log(`  max  : ${latencies[latencies.length - 1].toFixed(0)}`);

  if (errors.length > 0) {
    const byStatus = {};
    for (const e of errors) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    console.log(`\nPhân loại lỗi:`, byStatus);
  }

  // Ngưỡng tham chiếu: HHS/HIPAA không quy định con số cụ thể, dùng mục tiêu
  // chung của ngành cho ứng dụng nghiệp vụ nội bộ — p95 < 1s, lỗi < 1%.
  const p95 = percentile(latencies, 95);
  const errorRate = errors.length / totalRequests;
  const passed = p95 < 1000 && errorRate < 0.01;

  console.log(`\n${passed ? 'ĐẠT' : 'CHƯA ĐẠT'} mục tiêu tham chiếu (p95 < 1000ms, lỗi < 1%)`);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
