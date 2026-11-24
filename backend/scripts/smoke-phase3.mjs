import { authenticator } from 'otplib';
import { execFileSync } from 'node:child_process';

const BASE = 'http://localhost:4100/api';
let pass = 0, fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

async function req(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, body: json };
}

/** Thử một lệnh ghi lên nhật ký bằng tài khoản ứng dụng; true nghĩa là bị chặn. */
function writeToAuditIsBlocked(sql) {
  try {
    execFileSync(
      'docker',
      ['exec', 'crm-dk-postgres', 'psql', '-U', 'crm_app', '-d', 'crm_dk', '-v', 'ON_ERROR_STOP=1', '-c', sql],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    return false;
  } catch {
    return true;
  }
}

const PWD = 'DevPassword123!';

async function loginAs(email) {
  const first = await req('POST', '/auth/login', { body: { email, password: PWD } });
  if (!first.body?.mfaEnrollmentRequired) throw new Error(`${email}: cần chạy "npm run dev:reset-mfa" trước`);
  const token = first.body.enrollmentToken;
  const start = await req('POST', '/auth/mfa/enroll/start', { body: { enrollmentToken: token } });
  const secret = new URL(start.body.otpauthUrl).searchParams.get('secret');
  const done = await req('POST', '/auth/mfa/enroll/confirm', {
    body: { enrollmentToken: token, code: authenticator.generate(secret) },
  });
  return { token: done.body?.accessToken, user: done.body?.user };
}

console.log('\n--- Chuẩn bị ---');
const admin = await loginAs('admin@crm-dk.local');
const auditor = await loginAs('kiemtoan@crm-dk.local');
const doctor = await loginAs('bacsi@crm-dk.local');
check('đăng nhập admin / kiểm toán / bác sĩ', !!(admin.token && auditor.token && doctor.token));

console.log('\n--- 1. Quyền truy cập khu vực kiểm toán ---');
const byDoctor = await req('GET', '/audit/logs', { token: doctor.token });
check('bác sĩ KHÔNG xem được nhật ký → 403', byDoctor.status === 403, `status=${byDoctor.status}`);
const byAdmin = await req('GET', '/audit/logs', { token: admin.token });
check('admin xem được nhật ký', byAdmin.status === 200, `status=${byAdmin.status}`);
const byAuditor = await req('GET', '/audit/logs?pageSize=5', { token: auditor.token });
check('kiểm toán viên xem được nhật ký', byAuditor.status === 200, `status=${byAuditor.status}`);
check('nhật ký có dữ liệu', (byAuditor.body?.data?.length ?? 0) > 0, `got ${byAuditor.body?.data?.length}`);

console.log('\n--- 2. Lọc nhật ký ---');
const denied = await req('GET', '/audit/logs?outcome=denied&pageSize=100', { token: auditor.token });
check('lọc theo outcome=denied', denied.status === 200 && denied.body.data.every(r => r.outcome === 'denied'), 'có dòng không phải denied');
const byAction = await req('GET', '/audit/logs?action=LOGIN_SUCCESS&pageSize=50', { token: auditor.token });
check('lọc theo action', byAction.body?.data?.every(r => r.action === 'LOGIN_SUCCESS') ?? false);

console.log('\n--- 3. Nhật ký không chứa PHI plaintext ---');
const allLogs = await req('GET', '/audit/logs?pageSize=200', { token: auditor.token });
const raw = JSON.stringify(allLogs.body);
const phiLeaks = ['Trần Thị Mai', 'Nguyễn Văn Hùng', 'Đau ngực', 'I20.9', 'Metformin', 'DevPassword'];
const leaked = phiLeaks.filter(s => raw.includes(s));
check('không có PHI lọt vào nhật ký kiểm toán', leaked.length === 0, `lộ: ${leaked.join(', ')}`);

console.log('\n--- 4. Nhật ký truy cập PHI (accounting of disclosures) ---');
const phiAccess = await req('GET', '/audit/phi-access?pageSize=10', { token: auditor.token });
check('truy vấn được nhật ký truy cập PHI', phiAccess.status === 200, `status=${phiAccess.status}`);
check('có ghi tên bệnh nhân đã giải mã', !!phiAccess.body?.data?.[0]?.patientName, JSON.stringify(phiAccess.body?.data?.[0]));
check('có ghi ai đã truy cập', !!phiAccess.body?.data?.[0]?.actorEmail);
check('có ghi các trường đã xem', Array.isArray(phiAccess.body?.data?.[0]?.fieldsAccessed));

console.log('\n--- 5. Kiểm tra toàn vẹn chuỗi hash ---');
const integrity = await req('GET', '/audit/integrity', { token: auditor.token });
check('chuỗi hash hợp lệ', integrity.body?.valid === true, JSON.stringify(integrity.body));
check('đã kiểm tra toàn bộ dòng', (integrity.body?.entriesChecked ?? 0) > 0, `checked=${integrity.body?.entriesChecked}`);
// Mốc chuẩn phải luôn hiện diện trong kết quả, kèm số dòng nằm ngoài phạm vi
// kiểm tra — nếu không, một mốc bị đẩy lên sẽ âm thầm che giấu giả mạo.
check('báo rõ mốc chuẩn đã dùng', typeof integrity.body?.baselineId === 'string', JSON.stringify(integrity.body));
check('báo rõ số dòng nằm ngoài phạm vi', typeof integrity.body?.entriesBeforeBaseline === 'number', JSON.stringify(integrity.body));

console.log('\n--- 6. Nhật ký bất biến ở tầng database ---');
// Khả năng PHÁT HIỆN giả mạo (sửa nội dung / xoá dòng / chèn dòng) được kiểm
// chứng ở unit test src/audit/audit-chain.test.ts — chạy trên chuỗi tổng hợp
// trong bộ nhớ. Cố tình không kiểm ở đây: làm vậy phải tắt trigger bảo vệ nhật
// ký thật, và nếu script chết giữa chừng thì trigger nằm im ở trạng thái tắt.
check(
  'tài khoản ứng dụng KHÔNG sửa được nhật ký',
  writeToAuditIsBlocked("UPDATE audit_logs SET action = 'HACKED' WHERE id = (SELECT max(id) FROM audit_logs)"),
);
check(
  'tài khoản ứng dụng KHÔNG xoá được nhật ký',
  writeToAuditIsBlocked('DELETE FROM audit_logs WHERE id = (SELECT max(id) FROM audit_logs)'),
);
check(
  'tài khoản ứng dụng KHÔNG xoá được nhật ký truy cập PHI',
  writeToAuditIsBlocked('DELETE FROM phi_access_logs WHERE id = (SELECT max(id) FROM phi_access_logs)'),
);

console.log('\n--- 9. Phát hiện bất thường ---');
// Chủ động tạo đủ số lượt bị từ chối để vượt ngưỡng cảnh báo (5 lượt/tài khoản),
// mô phỏng hành vi dò quyền. Không dựa vào số lượt tình cờ sinh ra ở các bước
// trước — như vậy mới chứng minh được bộ phát hiện thật sự kích hoạt.
for (let i = 0; i < 6; i++) {
  await req('GET', '/audit/logs', { token: doctor.token });
}

const anomalies = await req('GET', '/audit/anomalies?windowHours=24', { token: auditor.token });
check('truy vấn được cảnh báo bất thường', anomalies.status === 200, `status=${anomalies.status}`);
check('trả về mảng cảnh báo', Array.isArray(anomalies.body?.anomalies), JSON.stringify(anomalies.body).slice(0, 200));
const kinds = new Set((anomalies.body?.anomalies ?? []).map(a => a.kind));
check('có phát hiện lượt bị từ chối quyền', kinds.has('repeated_denials'), `các loại: ${[...kinds].join(', ')}`);
const highSeverity = (anomalies.body?.anomalies ?? []).filter(a => a.severity === 'high');
check('cảnh báo nghiêm trọng xếp lên đầu',
  highSeverity.length === 0 || anomalies.body.anomalies[0].severity === 'high',
  `đầu tiên: ${anomalies.body?.anomalies?.[0]?.severity}`);

console.log('\n--- 10. Bảng số liệu tuân thủ ---');
const summary = await req('GET', '/audit/summary', { token: auditor.token });
check('lấy được số liệu tổng hợp', summary.status === 200, `status=${summary.status}`);
check('có tỉ lệ bật MFA', typeof summary.body?.mfaCoveragePercent === 'number', JSON.stringify(summary.body));
check('có số lượt truy cập PHI 24h', typeof summary.body?.phiAccessLast24h === 'number');

console.log('\n--- 11. Quản lý đồng ý của bệnh nhân ---');
const run = Date.now().toString().slice(-8);
const patient = await req('POST', '/patients', {
  token: admin.token,
  body: { firstName: 'Phạm Thị', lastName: 'Lan', dob: '1988-04-05', phone: `07${run}` },
});
const pid = patient.body?.id;
check('tạo bệnh nhân cho kịch bản đồng ý', patient.status === 201, JSON.stringify(patient.body));

const empty = await req('GET', `/consents?patientId=${pid}`, { token: admin.token });
check('bệnh nhân mới chưa có bản ghi đồng ý', empty.body?.length === 0, `got ${empty.body?.length}`);

const grant = await req('POST', '/consents', {
  token: admin.token,
  body: { patientId: pid, consentType: 'treatment', granted: true, documentVersion: 'v1.0', notes: 'Ký trực tiếp tại quầy' },
});
check('ghi nhận đồng ý điều trị → 201', grant.status === 201, JSON.stringify(grant.body));
check('đánh dấu đã đồng ý', grant.body?.granted === true);

const privacy = await req('POST', '/consents', {
  token: admin.token,
  body: { patientId: pid, consentType: 'privacy_notice', granted: true, documentVersion: 'v1.0' },
});
check('ghi nhận đồng ý thông báo quyền riêng tư', privacy.status === 201, `status=${privacy.status}`);

const marketing = await req('POST', '/consents', {
  token: admin.token,
  body: { patientId: pid, consentType: 'marketing', granted: false, documentVersion: 'v1.0' },
});
check('ghi nhận TỪ CHỐI nhận quảng cáo', marketing.status === 201 && marketing.body?.granted === false, JSON.stringify(marketing.body));

console.log('\n--- 12. Thay đổi quyết định đồng ý ---');
const changed = await req('POST', '/consents', {
  token: admin.token,
  body: { patientId: pid, consentType: 'treatment', granted: false, documentVersion: 'v1.1', notes: 'Bệnh nhân rút lại' },
});
check('ghi đè bằng quyết định mới', changed.status === 201, `status=${changed.status}`);

const history = await req('GET', `/consents?patientId=${pid}`, { token: admin.token });
check('giữ lại toàn bộ lịch sử (4 bản ghi)', history.body?.length === 4, `got ${history.body?.length}`);
const activeTreatment = history.body?.filter(c => c.consentType === 'treatment' && !c.revokedAt);
check('chỉ còn 1 bản treatment còn hiệu lực', activeTreatment?.length === 1, `got ${activeTreatment?.length}`);
check('bản còn hiệu lực là quyết định mới nhất', activeTreatment?.[0]?.documentVersion === 'v1.1', activeTreatment?.[0]?.documentVersion);
const revokedTreatment = history.body?.filter(c => c.consentType === 'treatment' && c.revokedAt);
check('bản cũ được đánh dấu thu hồi, không bị xoá', revokedTreatment?.length === 1, `got ${revokedTreatment?.length}`);

console.log('\n--- 13. Thu hồi và RBAC ---');
const revoke = await req('POST', `/consents/${privacy.body.id}/revoke`, { token: admin.token });
check('thu hồi được bản ghi đồng ý → 204', revoke.status === 204, `status=${revoke.status}`);
const revokeTwice = await req('POST', `/consents/${privacy.body.id}/revoke`, { token: admin.token });
check('thu hồi lần hai bị chặn → 409', revokeTwice.status === 409, `status=${revokeTwice.status}`);

const auditorWrite = await req('POST', '/consents', {
  token: auditor.token,
  body: { patientId: pid, consentType: 'research', granted: true, documentVersion: 'v1.0' },
});
check('kiểm toán viên KHÔNG ghi được đồng ý → 403', auditorWrite.status === 403, `status=${auditorWrite.status}`);

console.log('\n--- 14. Đồng ý được ghi vào nhật ký kiểm toán ---');
const consentLogs = await req('GET', '/audit/logs?pageSize=200', { token: auditor.token });
const consentActions = (consentLogs.body?.data ?? []).map(r => r.action);
check('có ghi CONSENT_GRANTED', consentActions.includes('CONSENT_GRANTED'));
check('có ghi CONSENT_DENIED', consentActions.includes('CONSENT_DENIED'));
check('có ghi CONSENT_REVOKED', consentActions.includes('CONSENT_REVOKED'));

const finalIntegrity = await req('GET', '/audit/integrity', { token: auditor.token });
check('chuỗi hash vẫn nguyên vẹn sau toàn bộ kịch bản', finalIntegrity.body?.valid === true, JSON.stringify(finalIntegrity.body));

console.log(`\n${'='.repeat(46)}\n  KẾT QUẢ PHASE 3: ${pass} pass, ${fail} fail\n${'='.repeat(46)}\n`);
process.exit(fail > 0 ? 1 : 0);
