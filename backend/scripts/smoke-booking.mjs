import { authenticator } from 'otplib';
import { execFileSync, spawn } from 'node:child_process';

const API_PORT = 4126;
const BASE = `http://localhost:${API_PORT}/api`;
const PWD = 'DevPassword123!';
let pass = 0, fail = 0;

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
function sql(q) {
  return execFileSync('docker', ['exec', 'crm-dk-postgres', 'psql', '-U', 'crm_app', '-d', 'crm_dk', '-t', '-A', '-c', q], { encoding: 'utf8' }).trim();
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
  const child = spawn('npx', ['tsx', 'src/server.ts'], { cwd: process.cwd(), shell: true, env: { ...process.env, PORT: String(API_PORT), LOG_LEVEL: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => process.stdout.write(`[api:err] ${d}`));
  return child;
}
async function waitHealthy(ms = 30000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(`http://localhost:${API_PORT}/api/health`)).ok) return true; } catch { /* chưa lên */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
let backend;
async function cleanup() {
  if (!backend) return;
  if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(backend.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* đã tắt */ } }
  else backend.kill('SIGTERM');
}

// Tìm ngày (trong ~10 ngày tới) còn khung giờ trống.
async function findDateWithSlots(branchId) {
  for (let i = 1; i <= 10; i++) {
    const d = new Date(Date.now() + 7 * 3600_000 + i * 86400_000).toISOString().slice(0, 10);
    const r = await req('GET', `/public/booking/slots?branchId=${branchId}&date=${d}`);
    if (Array.isArray(r.body) && r.body.length > 0) return { date: d, slots: r.body };
  }
  return null;
}

try {
  console.log('\n--- Chuẩn bị: backend riêng (cổng 4126) ---');
  backend = startBackend();
  const healthy = await waitHealthy();
  check('backend khởi động', healthy);
  if (!healthy) throw new Error('backend không lên');

  const admin = await loginAs('admin@crm-dk.local');
  const doctor = await loginAs('bacsi@crm-dk.local');
  check('đăng nhập admin + bác sĩ', !!(admin.token && doctor.token));
  check('admin có booking:manage', admin.user?.permissions?.includes('booking:manage'));
  check('bác sĩ KHÔNG có booking:manage', !doctor.user?.permissions?.includes('booking:manage'));

  const branchId = sql(`SELECT id FROM branches WHERE is_default`);

  console.log('\n--- 1. Public: chi nhánh + khung giờ ---');
  const pubBranches = await req('GET', '/public/booking/branches');
  check('GET branches (public) → có chi nhánh', Array.isArray(pubBranches.body) && pubBranches.body.length >= 1);
  const found = await findDateWithSlots(branchId);
  check('có ngày còn khung giờ trống', !!found, 'không tìm thấy trong 10 ngày');
  const { date, slots } = found;
  const slot = slots[0];

  console.log('\n--- 2. Public: gửi yêu cầu ---');
  const run = Date.now().toString().slice(-6);
  const bookA = await req('POST', '/public/booking', { body: { branchId, start: slot, fullName: 'Khách Online A', phone: `098${run}1`, note: 'Tư vấn trị mụn' } });
  check('tạo yêu cầu đặt lịch → 201 pending', bookA.status === 201 && bookA.body?.status === 'pending', JSON.stringify(bookA.body));
  const badStart = new Date(new Date(slot).getTime() + 5 * 60_000).toISOString();
  const bookBad = await req('POST', '/public/booking', { body: { branchId, start: badStart, fullName: 'X', phone: `098${run}9` } });
  check('khung giờ không hợp lệ → 409', bookBad.status === 409, `status=${bookBad.status}`);

  console.log('\n--- 3. RBAC hộp chờ ---');
  const docList = await req('GET', '/bookings', { token: doctor.token });
  check('bác sĩ xem hộp chờ → 403', docList.status === 403, `status=${docList.status}`);
  const pending = await req('GET', '/bookings', { token: admin.token });
  check('admin thấy yêu cầu đang chờ', pending.body?.some((b) => b.id === bookA.body.id));

  console.log('\n--- 4. Khớp bệnh nhân theo SĐT ---');
  const samePhone = `097${run}2`;
  await req('POST', '/patients', { token: admin.token, body: { firstName: 'Cũ', lastName: 'Khách', dob: '1980-02-02', phone: samePhone } });
  const bookMatch = await req('POST', '/public/booking', { body: { branchId, start: slots[1] ?? slot, fullName: 'Khách Cũ', phone: samePhone } });
  const matches = await req('GET', `/bookings/${bookMatch.body.id}/matches`, { token: admin.token });
  check('gợi ý khớp SĐT trả về bệnh nhân cũ', Array.isArray(matches.body) && matches.body.length >= 1, JSON.stringify(matches.body));

  console.log('\n--- 5. Xác nhận → tạo bệnh nhân + lịch hẹn ---');
  const confirm = await req('POST', `/bookings/${bookA.body.id}/confirm`, {
    token: admin.token,
    body: { doctorId: doctor.user.id, newPatient: { firstName: 'A', lastName: 'Khách Online', dob: '1995-05-05', gender: 'unknown' } },
  });
  check('xác nhận → 200 có appointmentId', confirm.status === 200 && !!confirm.body?.appointmentId, JSON.stringify(confirm.body));
  const apptRow = sql(`SELECT source||'|'||status||'|'||(branch_id IS NOT NULL)::text FROM appointments WHERE id='${confirm.body.appointmentId}'`);
  check('lịch hẹn: source=online, confirmed, có chi nhánh', apptRow === 'online|confirmed|true', `got '${apptRow}'`);
  const bStatus = sql(`SELECT status FROM booking_requests WHERE id='${bookA.body.id}'`);
  check('yêu cầu chuyển confirmed', bStatus === 'confirmed', `got '${bStatus}'`);
  const reConfirm = await req('POST', `/bookings/${bookA.body.id}/confirm`, { token: admin.token, body: { doctorId: doctor.user.id, newPatient: { firstName: 'A', lastName: 'B', dob: '1990-01-01' } } });
  check('xác nhận lại yêu cầu đã xử lý → 409', reConfirm.status === 409, `status=${reConfirm.status}`);

  console.log('\n--- 6. Từ chối ---');
  const rej = await req('POST', `/bookings/${bookMatch.body.id}/reject`, { token: admin.token, body: { reason: 'Khách đổi ý' } });
  check('từ chối → 204', rej.status === 204);
  check('yêu cầu chuyển rejected', sql(`SELECT status FROM booking_requests WHERE id='${bookMatch.body.id}'`) === 'rejected');

  console.log('\n--- 7. Audit ---');
  check('audit ghi BOOKING_CONFIRM', Number(sql(`SELECT count(*) FROM audit_logs WHERE action='BOOKING_CONFIRM' AND entity_id='${bookA.body.id}'`)) >= 1);

  console.log('\n==============================================');
  console.log(`  KẾT QUẢ BOOKING: ${pass} pass, ${fail} fail`);
  console.log('==============================================');
} catch (e) {
  console.error('LỖI:', e);
  fail++;
} finally {
  await cleanup();
  process.exit(fail === 0 ? 0 : 1);
}
