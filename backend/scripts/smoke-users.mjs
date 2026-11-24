import { authenticator } from 'otplib';
import { execFileSync, spawn } from 'node:child_process';

const API_PORT = 4115;
const BASE = `http://localhost:${API_PORT}/api`;
const PWD = 'DevPassword123!';
let pass = 0,
  fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

async function req(method, path, { body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-json */
  }
  return { status: res.status, body: json };
}

const rawLogin = (email, password) => req('POST', '/auth/login', { body: { email, password } });

async function loginAs(email) {
  const first = await rawLogin(email, PWD);
  if (!first.body?.mfaEnrollmentRequired) throw new Error(`${email}: cần "npm run dev:reset-mfa"`);
  const token = first.body.enrollmentToken;
  const start = await req('POST', '/auth/mfa/enroll/start', { body: { enrollmentToken: token } });
  const secret = new URL(start.body.otpauthUrl).searchParams.get('secret');
  const done = await req('POST', '/auth/mfa/enroll/confirm', {
    body: { enrollmentToken: token, code: authenticator.generate(secret) },
  });
  return { token: done.body?.accessToken, user: done.body?.user };
}

function startBackend() {
  const child = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: process.cwd(),
    shell: true,
    env: { ...process.env, PORT: String(API_PORT), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stdout.write(`[api:err] ${d}`));
  return child;
}
async function waitHealthy(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(`http://localhost:${API_PORT}/api/health`)).ok) return true;
    } catch {
      /* chưa lên */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let backend;
async function cleanup() {
  if (!backend) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(backend.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* đã tắt */
    }
  } else backend.kill('SIGTERM');
}

try {
  console.log('\n--- Chuẩn bị: backend riêng (cổng 4115) ---');
  backend = startBackend();
  const healthy = await waitHealthy();
  check('backend khởi động', healthy);
  if (!healthy) throw new Error('backend không lên');

  const admin = await loginAs('admin@crm-dk.local');
  const doctor = await loginAs('bacsi@crm-dk.local');
  check('đăng nhập admin + bác sĩ', !!(admin.token && doctor.token));

  console.log('\n--- 1. Danh sách vai trò + tài khoản ---');
  const roles = await req('GET', '/users/roles', { token: admin.token });
  const roleNames = (roles.body ?? []).map((r) => r.name);
  check('có đủ 5 vai trò', ['admin', 'doctor', 'nurse', 'receptionist', 'auditor'].every((r) => roleNames.includes(r)), roleNames.join(','));
  const list0 = await req('GET', '/users', { token: admin.token });
  check('liệt kê nhân viên (có admin)', (list0.body ?? []).some((u) => u.email === 'admin@crm-dk.local'), `n=${list0.body?.length}`);

  console.log('\n--- 2. Tạo tài khoản nhân viên mới ---');
  const run = Date.now().toString().slice(-8);
  const email = `bs.new.${run}@crm-dk.local`;
  const created = await req('POST', '/users', {
    token: admin.token,
    body: { email, fullName: 'BS. Người Mới', role: 'doctor', password: 'NewStaffPass123!' },
  });
  check('tạo bác sĩ mới → 201', created.status === 201 && created.body?.role === 'doctor', JSON.stringify(created.body));
  const newId = created.body?.id;
  check('mfa chưa bật (đăng ký ở lần đăng nhập đầu)', created.body?.mfaEnabled === false);
  const listed = await req('GET', '/users', { token: admin.token });
  check('tài khoản mới xuất hiện trong danh sách', (listed.body ?? []).some((u) => u.id === newId));

  console.log('\n--- 3. Tài khoản mới đăng nhập được ---');
  const newLogin = await rawLogin(email, 'NewStaffPass123!');
  check('đăng nhập tài khoản mới → yêu cầu đăng ký MFA', newLogin.body?.mfaEnrollmentRequired === true, JSON.stringify(newLogin.body));

  console.log('\n--- 4. Ràng buộc tạo ---');
  const dup = await req('POST', '/users', {
    token: admin.token,
    body: { email, fullName: 'Trùng', role: 'nurse', password: 'AnotherPass12345' },
  });
  check('email trùng → 409', dup.status === 409, `status=${dup.status}`);
  const weak = await req('POST', '/users', {
    token: admin.token,
    body: { email: `x.${run}@crm-dk.local`, fullName: 'Yếu', role: 'nurse', password: 'short' },
  });
  check('mật khẩu <12 ký tự → 400', weak.status === 400, `status=${weak.status}`);
  const badRole = await req('POST', '/users', {
    token: admin.token,
    body: { email: `y.${run}@crm-dk.local`, fullName: 'Sai vai trò', role: 'superadmin', password: 'ValidPass123456' },
  });
  check('vai trò không hợp lệ → 400', badRole.status === 400, `status=${badRole.status}`);

  console.log('\n--- 5. Sửa thông tin + đổi vai trò ---');
  const upd = await req('PATCH', `/users/${newId}`, { token: admin.token, body: { fullName: 'ĐD. Đổi Vai Trò', role: 'nurse' } });
  check('đổi tên + vai trò sang điều dưỡng → 200', upd.status === 200 && upd.body?.role === 'nurse' && upd.body?.fullName === 'ĐD. Đổi Vai Trò', JSON.stringify(upd.body));

  console.log('\n--- 6. Khoá tài khoản → thu hồi phiên, chặn đăng nhập ---');
  const suspend = await req('PATCH', `/users/${newId}`, { token: admin.token, body: { status: 'suspended' } });
  check('khoá tài khoản → status suspended', suspend.body?.status === 'suspended');
  const blocked = await rawLogin(email, 'NewStaffPass123!');
  check('tài khoản bị khoá không đăng nhập được → 403', blocked.status === 403, `status=${blocked.status}`);

  console.log('\n--- 7. Đặt lại mật khẩu + kích hoạt lại ---');
  const reset = await req('POST', `/users/${newId}/reset-password`, { token: admin.token, body: { newPassword: 'BrandNewPass99999' } });
  check('đặt lại mật khẩu → 204', reset.status === 204, `status=${reset.status}`);
  await req('PATCH', `/users/${newId}`, { token: admin.token, body: { status: 'active' } });
  const oldPw = await rawLogin(email, 'NewStaffPass123!');
  check('mật khẩu CŨ không dùng được nữa → 401', oldPw.status === 401, `status=${oldPw.status}`);
  const newPw = await rawLogin(email, 'BrandNewPass99999');
  check('mật khẩu MỚI đăng nhập được', newPw.body?.mfaEnrollmentRequired === true, JSON.stringify(newPw.body));

  console.log('\n--- 8. Gỡ MFA (khôi phục mất thiết bị) ---');
  const resetMfa = await req('POST', `/users/${newId}/reset-mfa`, { token: admin.token });
  check('gỡ MFA → 204', resetMfa.status === 204, `status=${resetMfa.status}`);

  console.log('\n--- 9. Chặn tự khoá/tự hạ quyền + last-admin ---');
  const selfSuspend = await req('PATCH', `/users/${admin.user.id}`, { token: admin.token, body: { status: 'suspended' } });
  check('admin tự khoá mình → 400', selfSuspend.status === 400, `status=${selfSuspend.status}`);
  const selfDemote = await req('PATCH', `/users/${admin.user.id}`, { token: admin.token, body: { role: 'nurse' } });
  check('admin tự hạ vai trò mình → 400', selfDemote.status === 400, `status=${selfDemote.status}`);

  console.log('\n--- 10. RBAC ---');
  const docList = await req('GET', '/users', { token: doctor.token });
  check('bác sĩ (không user:read) liệt kê nhân viên → 403', docList.status === 403, `status=${docList.status}`);
  const docCreate = await req('POST', '/users', {
    token: doctor.token,
    body: { email: `z.${run}@crm-dk.local`, fullName: 'x', role: 'nurse', password: 'ValidPass123456' },
  });
  check('bác sĩ tạo tài khoản → 403', docCreate.status === 403, `status=${docCreate.status}`);

  console.log('\n--- 11. Audit ---');
  const audit = await req('GET', '/audit/logs?pageSize=200', { token: admin.token });
  const actions = (audit.body?.data ?? []).map((l) => l.action);
  check('audit có USER_CREATE + USER_UPDATE + USER_PASSWORD_RESET', ['USER_CREATE', 'USER_UPDATE', 'USER_PASSWORD_RESET'].every((a) => actions.includes(a)), actions.slice(0, 12).join(','));
} catch (err) {
  fail++;
  console.error('LỖI:', err.stack || err.message);
} finally {
  await cleanup();
}

console.log(`\n${'='.repeat(48)}\n  KẾT QUẢ USERS: ${pass} pass, ${fail} fail\n${'='.repeat(48)}\n`);
process.exit(fail > 0 ? 1 : 0);
