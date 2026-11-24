import { authenticator } from 'otplib';

const BASE = 'http://localhost:4100/api';
let pass = 0, fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

async function req(method, path, { body, token, cookie } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, body: json, setCookie: res.headers.get('set-cookie') };
}

const PWD = 'DevPassword123!';
async function loginStaff(email) {
  const first = await req('POST', '/auth/login', { body: { email, password: PWD } });
  if (!first.body?.mfaEnrollmentRequired) throw new Error(`${email}: cần reset MFA`);
  const t = first.body.enrollmentToken;
  const start = await req('POST', '/auth/mfa/enroll/start', { body: { enrollmentToken: t } });
  const secret = new URL(start.body.otpauthUrl).searchParams.get('secret');
  const done = await req('POST', '/auth/mfa/enroll/confirm', { body: { enrollmentToken: t, code: authenticator.generate(secret) } });
  return { token: done.body?.accessToken, user: done.body?.user };
}

console.log('\n--- Chuẩn bị: nhân viên tạo 2 bệnh nhân + tài khoản cổng ---');
const admin = await loginStaff('admin@crm-dk.local');
const nurse = await loginStaff('yta@crm-dk.local');

const run = Date.now().toString().slice(-8);
const emailA = `benhnhanA.${run}@example.com`;
const emailB = `benhnhanB.${run}@example.com`;

const patA = await req('POST', '/patients', { token: admin.token, body: { firstName: 'Bệnh Nhân', lastName: 'A', dob: '1990-01-01', email: emailA, phone: `091${run}` } });
const patB = await req('POST', '/patients', { token: admin.token, body: { firstName: 'Bệnh Nhân', lastName: 'B', dob: '1985-05-05', email: emailB, phone: `092${run}` } });
const pidA = patA.body?.id, pidB = patB.body?.id;
const mrnA = patA.body?.mrn;
check('tạo 2 bệnh nhân', !!(pidA && pidB), JSON.stringify({ pidA, pidB }));

// Bác sĩ tạo dữ liệu lâm sàng cho A
const doctor = await loginStaff('bacsi@crm-dk.local');
const doctorId = doctor.user.id;
// Khung giờ rất xa + ngẫu nhiên rộng để chắc chắn không trùng giờ bác sĩ.
const t0 = new Date(Date.now() + (200 + Math.floor(Math.random() * 3000)) * 86400_000 + Math.floor(Math.random() * 80000) * 1000);
t0.setSeconds(0, 0);
const apptCreate = await req('POST', '/appointments', { token: doctor.token, body: { patientId: pidA, doctorId, scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 1800_000).toISOString(), reason: 'Khám định kỳ' } });
check('tạo lịch hẹn cho A', apptCreate.status === 201, JSON.stringify(apptCreate.body));
const rx = await req('POST', '/prescriptions', { token: doctor.token, body: { patientId: pidA, medication: 'Vitamin D', dosage: '1000 IU', frequency: '1 lần/ngày' } });
check('chuẩn bị dữ liệu lâm sàng cho A', rx.status === 201, JSON.stringify(rx.body));

console.log('\n--- 1. Tạo tài khoản cổng ---');
const noPermCreate = await req('POST', `/patients/${pidA}/portal-account`, { token: doctor.token, body: { loginEmail: emailA } });
check('bác sĩ KHÔNG tạo được tài khoản cổng (thiếu portal:manage) → 403', noPermCreate.status === 403, `status=${noPermCreate.status}`);

const createA = await req('POST', `/patients/${pidA}/portal-account`, { token: nurse.token, body: { loginEmail: emailA } });
check('y tá KHÔNG tạo được (thiếu portal:manage) → 403', createA.status === 403, `status=${createA.status}`);

const accA = await req('POST', `/patients/${pidA}/portal-account`, { token: admin.token, body: { loginEmail: emailA } });
check('admin tạo tài khoản cổng cho A → 201', accA.status === 201, JSON.stringify(accA.body));
check('trả mật khẩu tạm', typeof accA.body?.tempPassword === 'string' && accA.body.tempPassword.length >= 10);
const pwA = accA.body.tempPassword;

const dupAcc = await req('POST', `/patients/${pidA}/portal-account`, { token: admin.token, body: { loginEmail: `khac.${run}@example.com` } });
check('tạo tài khoản thứ hai cho cùng bệnh nhân → 409', dupAcc.status === 409, `status=${dupAcc.status}`);

const accB = await req('POST', `/patients/${pidB}/portal-account`, { token: admin.token, body: { loginEmail: emailB } });
const pwB = accB.body.tempPassword;
check('tạo tài khoản cổng cho B', accB.status === 201);

console.log('\n--- 2. Đăng nhập cổng ---');
const badLogin = await req('POST', '/portal/auth/login', { body: { email: emailA, password: 'saimatkhau' } });
check('sai mật khẩu → 401', badLogin.status === 401, `status=${badLogin.status}`);
const loginA = await req('POST', '/portal/auth/login', { body: { email: emailA, password: pwA } });
check('đăng nhập A thành công → accessToken', !!loginA.body?.accessToken, JSON.stringify(loginA.body).slice(0, 120));
check('cờ buộc đổi mật khẩu lần đầu', loginA.body?.mustChangePassword === true);
check('trả hồ sơ đúng bệnh nhân A', loginA.body?.patient?.mrn === mrnA, JSON.stringify(loginA.body?.patient));
const tokenA = loginA.body.accessToken;
const refreshCookieA = (loginA.setCookie ?? '').split(';')[0];

const loginB = await req('POST', '/portal/auth/login', { body: { email: emailB, password: pwB } });
const tokenB = loginB.body.accessToken;

console.log('\n--- 3. Bệnh nhân chỉ thấy dữ liệu CỦA MÌNH ---');
const meA = await req('GET', '/portal/me', { token: tokenA });
check('A xem được hồ sơ của mình', meA.body?.mrn === mrnA, JSON.stringify(meA.body));
check('hồ sơ giải mã đúng (tên A)', meA.body?.fullName === 'Bệnh Nhân A', meA.body?.fullName);

const apptA = await req('GET', '/portal/appointments', { token: tokenA });
check('A thấy lịch hẹn của mình', apptA.body?.length === 1, `got ${apptA.body?.length}`);

const rxA = await req('GET', '/portal/prescriptions', { token: tokenA });
check('A thấy đơn thuốc của mình', rxA.body?.length === 1 && rxA.body[0].medication === 'Vitamin D', JSON.stringify(rxA.body));

console.log('\n--- 4. CÁCH LY: B không thấy gì của A ---');
const apptB = await req('GET', '/portal/appointments', { token: tokenB });
check('B KHÔNG thấy lịch hẹn của A (0 lịch)', apptB.body?.length === 0, `got ${apptB.body?.length}`);
const rxB = await req('GET', '/portal/prescriptions', { token: tokenB });
check('B KHÔNG thấy đơn thuốc của A', rxB.body?.length === 0, `got ${rxB.body?.length}`);
const meB = await req('GET', '/portal/me', { token: tokenB });
check('B chỉ thấy hồ sơ của chính B', meB.body?.fullName === 'Bệnh Nhân B', meB.body?.fullName);

console.log('\n--- 5. CÁCH LY token: chéo giữa nhân viên và bệnh nhân ---');
const staffOnPortal = await req('GET', '/portal/me', { token: admin.token });
check('token NHÂN VIÊN không dùng được ở cổng bệnh nhân → 401', staffOnPortal.status === 401, `status=${staffOnPortal.status}`);
const patientOnStaff = await req('GET', '/patients', { token: tokenA });
check('token BỆNH NHÂN không dùng được ở endpoint nhân viên → 401', patientOnStaff.status === 401, `status=${patientOnStaff.status}`);
const patientOnPatientList = await req('GET', `/patients/${pidB}`, { token: tokenA });
check('bệnh nhân A không đọc được hồ sơ B qua endpoint nhân viên → 401', patientOnPatientList.status === 401, `status=${patientOnPatientList.status}`);

console.log('\n--- 6. Đổi mật khẩu ---');
const changePw = await req('POST', '/portal/auth/change-password', { token: tokenA, body: { currentPassword: pwA, newPassword: 'MatKhauMoi123456' } });
check('đổi mật khẩu → 204', changePw.status === 204, `status=${changePw.status}`);
const loginOldPw = await req('POST', '/portal/auth/login', { body: { email: emailA, password: pwA } });
check('mật khẩu cũ không dùng được nữa → 401', loginOldPw.status === 401, `status=${loginOldPw.status}`);
const loginNewPw = await req('POST', '/portal/auth/login', { body: { email: emailA, password: 'MatKhauMoi123456' } });
check('mật khẩu mới đăng nhập được', loginNewPw.status === 200 && loginNewPw.body?.mustChangePassword === false, JSON.stringify(loginNewPw.body?.mustChangePassword));

console.log('\n--- 7. Refresh token ---');
const refreshed = await req('POST', '/portal/auth/refresh', { cookie: refreshCookieA });
// refreshCookieA thuộc phiên đã bị thu hồi khi đổi mật khẩu → phải 401
check('refresh bằng phiên đã thu hồi (đổi mk) → 401', refreshed.status === 401, `status=${refreshed.status}`);

console.log('\n--- 8. Audit ---');
const logs = await req('GET', '/audit/logs?pageSize=200', { token: admin.token });
const actions = (logs.body?.data ?? []).map((l) => l.action);
check('có ghi PORTAL_ACCOUNT_CREATE', actions.includes('PORTAL_ACCOUNT_CREATE'));
check('có ghi PORTAL_LOGIN', actions.includes('PORTAL_LOGIN'));
check('có ghi PORTAL_PASSWORD_CHANGE', actions.includes('PORTAL_PASSWORD_CHANGE'));
const raw = JSON.stringify(logs.body);
check('audit không lộ email/tên bệnh nhân', !raw.includes(emailA) && !raw.includes('Bệnh Nhân A'));

console.log(`\n${'='.repeat(46)}\n  KẾT QUẢ PORTAL: ${pass} pass, ${fail} fail\n${'='.repeat(46)}\n`);
process.exit(fail > 0 ? 1 : 0);
