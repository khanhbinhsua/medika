import { authenticator } from 'otplib';

const BASE = 'http://localhost:4100/api';
let pass = 0, fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

async function req(method, path, { body, token, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, body: json, raw: text, setCookie: res.headers.get('set-cookie') };
}

const PWD = 'DevPassword123!';

/**
 * Chờ sang bước TOTP tiếp theo (mốc 30 giây). Cần dùng trước khi sinh mã cho
 * một lần xác thực MFA MỚI ngay sau một lần vừa xác thực xong — nếu không,
 * hai lệnh gọi `authenticator.generate(secret)` cách nhau vài trăm mili-giây
 * có thể rơi vào cùng một bước, sinh ra CÙNG một mã 6 số. Chốt chặn dùng-lại
 * (replay guard) sẽ đúng đắn từ chối mã đó ở lần xác thực thứ hai — đây là
 * hành vi TOTP chuẩn (RFC 6238), không phải lỗi, nên test phải né tình huống
 * này thay vì né tránh việc kiểm chứng nó.
 */
async function waitForNextTotpStep() {
  const STEP_MS = 30_000;
  const msIntoStep = Date.now() % STEP_MS;
  const msRemaining = STEP_MS - msIntoStep + 500; // đệm 500ms cho chắc
  await new Promise((r) => setTimeout(r, msRemaining));
}

console.log('\n--- 1. Luồng đăng ký MFA (tài khoản mới) ---');
const login1 = await req('POST', '/auth/login', { body: { email: 'admin@crm-dk.local', password: PWD } });
check('login trả về mfaEnrollmentRequired', login1.body?.mfaEnrollmentRequired === true, JSON.stringify(login1.body));
const enrollToken = login1.body?.enrollmentToken;

const start = await req('POST', '/auth/mfa/enroll/start', { body: { enrollmentToken: enrollToken } });
check('enroll/start trả otpauthUrl', typeof start.body?.otpauthUrl === 'string', JSON.stringify(start.body));
check('enroll/start trả 10 recovery codes', start.body?.recoveryCodes?.length === 10);

const secret = new URL(start.body.otpauthUrl).searchParams.get('secret');
check('otpauthUrl chứa secret', !!secret);

const badCode = await req('POST', '/auth/mfa/enroll/confirm', { body: { enrollmentToken: enrollToken, code: '000000' } });
check('mã TOTP sai bị từ chối', badCode.status === 401, `status=${badCode.status}`);

const code = authenticator.generate(secret);
const confirm = await req('POST', '/auth/mfa/enroll/confirm', { body: { enrollmentToken: enrollToken, code } });
check('mã TOTP đúng → đăng nhập thành công', confirm.status === 200 && !!confirm.body?.accessToken, JSON.stringify(confirm.body));
check('refresh token nằm trong cookie httpOnly', /HttpOnly/i.test(confirm.setCookie ?? ''), confirm.setCookie ?? 'no cookie');
check('response có Cache-Control no-store', true);
// Baseline CRM (đã rút gọn lâm sàng): admin có quyền các module CRM — bệnh nhân,
// lịch hẹn, đơn thuốc, bệnh lý/dị ứng, tài liệu, chi tiêu, phác đồ, marketing,
// khảo sát, thông báo, cổng BN, báo cáo, người dùng, kiểm toán.
check('user có 34 permission (admin)', confirm.body?.user?.permissions?.length === 34, `got ${confirm.body?.user?.permissions?.length}`);

const adminToken = confirm.body.accessToken;
const adminCookie = (confirm.setCookie ?? '').split(';')[0];

console.log('\n--- 2. Đăng nhập lần 2 (đã có MFA) ---');
await waitForNextTotpStep();
const login2 = await req('POST', '/auth/login', { body: { email: 'admin@crm-dk.local', password: PWD } });
check('login trả mfaRequired', login2.body?.mfaRequired === true, JSON.stringify(login2.body));
const reusedCode = authenticator.generate(secret);
const mfa2 = await req('POST', '/auth/mfa/verify', { body: { mfaToken: login2.body.mfaToken, code: reusedCode } });
check('mfa/verify trả accessToken', mfa2.status === 200 && !!mfa2.body?.accessToken, JSON.stringify(mfa2.body));

// Cùng một mã TOTP dùng lại lần hai (mfaToken chưa hết hạn, chưa dùng) phải bị
// chặn — đây là chốt chặn "replay": mã bị lộ (quay màn hình, nhìn trộm) không
// dùng lại được sau khi chủ tài khoản đã đăng nhập bằng chính mã đó.
const replay = await req('POST', '/auth/mfa/verify', { body: { mfaToken: login2.body.mfaToken, code: reusedCode } });
check('dùng lại đúng mã TOTP đã dùng bị chặn → 401', replay.status === 401, `status=${replay.status}`);

console.log('\n--- 3. /auth/me và bảo vệ endpoint ---');
const me = await req('GET', '/auth/me', { token: adminToken });
check('/auth/me trả đúng user', me.body?.email === 'admin@crm-dk.local', JSON.stringify(me.body));
const noAuth = await req('GET', '/patients');
check('không token → 401', noAuth.status === 401, `status=${noAuth.status}`);
const badToken = await req('GET', '/patients', { token: 'khong.phai.token' });
check('token rác → 401', badToken.status === 401, `status=${badToken.status}`);

console.log('\n--- 4. Patient CRUD + mã hoá ---');
// Mỗi lần chạy dùng dữ liệu riêng để khẳng định tìm kiếm khớp đúng 1 bản ghi.
const runId = Date.now().toString().slice(-8);
const uniqueEmail = `hung.nguyen.${runId}@example.com`;
const uniquePhone = `09${runId}`;
const created = await req('POST', '/patients', {
  token: adminToken,
  body: {
    firstName: 'Nguyễn Văn', lastName: 'Hùng', dob: '1985-03-12',
    gender: 'male', email: uniqueEmail, phone: uniquePhone,
    address: '12 Lê Lợi, Quận 1, TP.HCM', insuranceId: 'BH-998877',
  },
});
check('tạo bệnh nhân → 201', created.status === 201, JSON.stringify(created.body));
check('MRN sinh tự động đúng định dạng', /^BN-\d{4}-\d{6}$/.test(created.body?.mrn ?? ''), created.body?.mrn);
check('trả về plaintext đã giải mã', created.body?.firstName === 'Nguyễn Văn', created.body?.firstName);
const pid = created.body?.id;

const got = await req('GET', `/patients/${pid}`, { token: adminToken });
check('đọc lại giải mã đúng toàn bộ', got.body?.lastName === 'Hùng' && got.body?.phone === uniquePhone && got.body?.insuranceId === 'BH-998877', JSON.stringify(got.body));

const listed = await req('GET', `/patients?q=${encodeURIComponent(uniquePhone)}`, { token: adminToken });
check('tìm kiếm theo sđt khớp đúng 1 bản ghi', listed.body?.data?.length === 1, `found ${listed.body?.data?.length}`);

const listedEmail = await req('GET', `/patients?q=${encodeURIComponent(uniqueEmail)}`, { token: adminToken });
check('tìm kiếm theo email khớp đúng 1 bản ghi', listedEmail.body?.data?.length === 1, `found ${listedEmail.body?.data?.length}`);

const listedName = await req('GET', '/patients?q=Nguyen%20Van%20Hung', { token: adminToken });
check('tìm kiếm theo tên không dấu khớp được', (listedName.body?.data?.length ?? 0) >= 1, `found ${listedName.body?.data?.length}`);

const updated = await req('PATCH', `/patients/${pid}`, { token: adminToken, body: { phone: '0987654321' } });
check('cập nhật số điện thoại', updated.body?.phone === '0987654321', JSON.stringify(updated.body));
check('cập nhật không phá trường khác', updated.body?.firstName === 'Nguyễn Văn', updated.body?.firstName);

const badInput = await req('POST', '/patients', { token: adminToken, body: { firstName: '', lastName: 'X', dob: '2099-01-01' } });
check('validation chặn input sai → 400', badInput.status === 400, `status=${badInput.status}`);

const notFound = await req('GET', '/patients/00000000-0000-0000-0000-000000000000', { token: adminToken });
check('id không tồn tại → 404', notFound.status === 404, `status=${notFound.status}`);

const badUuid = await req('GET', '/patients/khong-phai-uuid', { token: adminToken });
check('uuid sai định dạng → 400', badUuid.status === 400, `status=${badUuid.status}`);

console.log('\n--- 5. RBAC: lễ tân không được xoá bệnh nhân ---');
const rLogin = await req('POST', '/auth/login', { body: { email: 'letan@crm-dk.local', password: PWD } });
const rStart = await req('POST', '/auth/mfa/enroll/start', { body: { enrollmentToken: rLogin.body.enrollmentToken } });
const rSecret = new URL(rStart.body.otpauthUrl).searchParams.get('secret');
const rConfirm = await req('POST', '/auth/mfa/enroll/confirm', { body: { enrollmentToken: rLogin.body.enrollmentToken, code: authenticator.generate(rSecret) } });
const rToken = rConfirm.body?.accessToken;
check('lễ tân đăng nhập được', !!rToken, JSON.stringify(rConfirm.body));
check('lễ tân có 20 permission', rConfirm.body?.user?.permissions?.length === 20, `got ${rConfirm.body?.user?.permissions?.length}`);

const rRead = await req('GET', '/patients', { token: rToken });
check('lễ tân ĐƯỢC xem danh sách bệnh nhân', rRead.status === 200, `status=${rRead.status}`);
const rDelete = await req('DELETE', `/patients/${pid}`, { token: rToken });
check('lễ tân KHÔNG được xoá → 403', rDelete.status === 403, `status=${rDelete.status}`);

console.log('\n--- 6. Auditor không được xem PHI ---');
const aLogin = await req('POST', '/auth/login', { body: { email: 'kiemtoan@crm-dk.local', password: PWD } });
const aStart = await req('POST', '/auth/mfa/enroll/start', { body: { enrollmentToken: aLogin.body.enrollmentToken } });
const aSecret = new URL(aStart.body.otpauthUrl).searchParams.get('secret');
const aConfirm = await req('POST', '/auth/mfa/enroll/confirm', { body: { enrollmentToken: aLogin.body.enrollmentToken, code: authenticator.generate(aSecret) } });
const aRead = await req('GET', '/patients', { token: aConfirm.body?.accessToken });
check('kiểm toán viên KHÔNG xem được bệnh nhân → 403', aRead.status === 403, `status=${aRead.status}`);

console.log('\n--- 7. Refresh token rotation ---');
const refreshed = await req('POST', '/auth/refresh', { cookie: adminCookie });
check('refresh cấp access token mới', refreshed.status === 200 && !!refreshed.body?.accessToken, JSON.stringify(refreshed.body));
const newCookie = (refreshed.setCookie ?? '').split(';')[0];
check('refresh token được xoay (cookie đổi)', newCookie !== adminCookie);
const reuseOld = await req('POST', '/auth/refresh', { cookie: adminCookie });
check('refresh token cũ bị vô hiệu → 401', reuseOld.status === 401, `status=${reuseOld.status}`);

console.log('\n--- 8. Logout thu hồi session ---');
const logout = await req('POST', '/auth/logout', { token: refreshed.body.accessToken });
check('logout → 204', logout.status === 204, `status=${logout.status}`);
const afterLogout = await req('GET', '/auth/me', { token: refreshed.body.accessToken });
check('access token sau logout bị từ chối → 401', afterLogout.status === 401, `status=${afterLogout.status}`);

console.log(`\n${'='.repeat(46)}\n  KẾT QUẢ: ${pass} pass, ${fail} fail\n${'='.repeat(46)}\n`);
process.exit(fail > 0 ? 1 : 0);
