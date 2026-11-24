import { authenticator } from 'otplib';
import { execFileSync, spawn } from 'node:child_process';

const API_PORT = 4125;
const BASE = `http://localhost:${API_PORT}/api`;
const PWD = 'DevPassword123!';
let pass = 0,
  fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

async function req(method, path, { body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, body: json };
}

function sql(query) {
  return execFileSync('docker', ['exec', 'crm-dk-postgres', 'psql', '-U', 'crm_app', '-d', 'crm_dk', '-t', '-A', '-c', query], { encoding: 'utf8' }).trim();
}

async function loginAs(email) {
  const first = await req('POST', '/auth/login', { body: { email, password: PWD } });
  if (!first.body?.mfaEnrollmentRequired) throw new Error(`${email}: cần reset MFA trước`);
  const token = first.body.enrollmentToken;
  const start = await req('POST', '/auth/mfa/enroll/start', { body: { enrollmentToken: token } });
  const secret = new URL(start.body.otpauthUrl).searchParams.get('secret');
  const done = await req('POST', '/auth/mfa/enroll/confirm', { body: { enrollmentToken: token, code: authenticator.generate(secret) } });
  return { token: done.body?.accessToken, user: done.body?.user };
}

function startBackend() {
  const child = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: process.cwd(), shell: true,
    env: { ...process.env, PORT: String(API_PORT), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stdout.write(`[api:err] ${d}`));
  return child;
}
async function waitHealthy(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(`http://localhost:${API_PORT}/api/health`)).ok) return true; } catch { /* chưa lên */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let backend;
async function cleanup() {
  if (!backend) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(backend.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* đã tắt */ }
  } else backend.kill('SIGTERM');
}

try {
  console.log('\n--- Chuẩn bị: backend riêng (cổng 4125) ---');
  backend = startBackend();
  const healthy = await waitHealthy();
  check('backend khởi động', healthy);
  if (!healthy) throw new Error('backend không lên');

  const admin = await loginAs('admin@crm-dk.local');
  const doctor = await loginAs('bacsi@crm-dk.local');
  check('đăng nhập admin + bác sĩ', !!(admin.token && doctor.token));
  check('admin có branch:manage', admin.user?.permissions?.includes('branch:manage'));
  check('bác sĩ có branch:read, KHÔNG có branch:manage',
    doctor.user?.permissions?.includes('branch:read') && !doctor.user?.permissions?.includes('branch:manage'));

  console.log('\n--- 1. Chi nhánh của tôi (topbar) ---');
  const mine = await req('GET', '/branches', { token: doctor.token });
  check('GET /branches → có chi nhánh mặc định', Array.isArray(mine.body) && mine.body.some((b) => b.isDefault), JSON.stringify(mine.body?.[0]));
  check('mặc định xếp đầu', mine.body?.[0]?.isDefault === true);

  console.log('\n--- 2. RBAC ---');
  const docCreate = await req('POST', '/branches', { token: doctor.token, body: { name: 'X' } });
  check('bác sĩ tạo chi nhánh → 403', docCreate.status === 403, `status=${docCreate.status}`);
  const docAll = await req('GET', '/branches/all', { token: doctor.token });
  check('bác sĩ gọi /branches/all → 403', docAll.status === 403, `status=${docAll.status}`);

  console.log('\n--- 3. Admin: tạo + phân công ---');
  const run = Date.now().toString().slice(-6);
  const created = await req('POST', '/branches', { token: admin.token, body: { name: `CN Quận ${run}`, code: `Q${run}`, address: '1 Lê Lợi' } });
  check('admin tạo chi nhánh → 201', created.status === 201, JSON.stringify(created.body));
  check('chi nhánh mới KHÔNG phải mặc định', created.body?.isDefault === false);
  const bid = created.body?.id;
  const all = await req('GET', '/branches/all', { token: admin.token });
  check('danh sách all gồm chi nhánh mới', all.body?.some((b) => b.id === bid));

  const assign = await req('POST', `/branches/${bid}/users`, { token: admin.token, body: { userId: doctor.user.id } });
  check('phân công bác sĩ vào chi nhánh → 204', assign.status === 204, `status=${assign.status}`);
  const assignAgain = await req('POST', `/branches/${bid}/users`, { token: admin.token, body: { userId: doctor.user.id } });
  check('phân công lại (idempotent) → 204', assignAgain.status === 204);
  const staff = await req('GET', `/branches/${bid}/users`, { token: admin.token });
  check('danh sách nhân viên gồm bác sĩ', staff.body?.some((u) => u.id === doctor.user.id));

  // Bác sĩ giờ thấy 2 chi nhánh trên topbar
  const mine2 = await req('GET', '/branches', { token: doctor.token });
  check('bác sĩ nay thuộc 2 chi nhánh', mine2.body?.length === 2, `len=${mine2.body?.length}`);

  const unassign = await req('DELETE', `/branches/${bid}/users/${doctor.user.id}`, { token: admin.token });
  check('gỡ phân công → 204', unassign.status === 204);

  console.log('\n--- 4. Lịch hẹn mới được gắn branch_id ---');
  const p = (await req('POST', '/patients', { token: admin.token, body: { firstName: 'Chi', lastName: 'Nhanh', dob: '1990-01-01', gender: 'other', phone: `09${run}00` } })).body;
  const t0 = new Date(Date.now() + (500 + Math.floor(Math.random() * 2000)) * 86400000); t0.setSeconds(0, 0);
  const appt = await req('POST', '/appointments', { token: doctor.token, body: { patientId: p.id, doctorId: doctor.user.id, scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 1800000).toISOString(), reason: 'Khám' } });
  check('tạo lịch hẹn → 201', appt.status === 201, JSON.stringify(appt.body));
  const apptBranch = sql(`SELECT b.is_default::text FROM appointments a JOIN branches b ON b.id=a.branch_id WHERE a.id='${appt.body.id}'`);
  check('lịch hẹn mới gắn chi nhánh mặc định', apptBranch === 'true', `got '${apptBranch}'`);

  console.log('\n--- 5. Audit ---');
  const audited = sql(`SELECT count(*) FROM audit_logs WHERE action='BRANCH_CREATE' AND entity_id='${bid}'`);
  check('audit ghi BRANCH_CREATE', Number(audited) >= 1);

  console.log('\n==============================================');
  console.log(`  KẾT QUẢ BRANCHES: ${pass} pass, ${fail} fail`);
  console.log('==============================================');
} catch (e) {
  console.error('LỖI:', e);
  fail++;
} finally {
  await cleanup();
  process.exit(fail === 0 ? 0 : 1);
}
