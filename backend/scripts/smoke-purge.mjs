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

function sql(query) {
  return execFileSync('docker', ['exec', 'crm-dk-postgres', 'psql', '-U', 'crm_app', '-d', 'crm_dk', '-t', '-A', '-c', query], {
    encoding: 'utf8',
  }).trim();
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
const doctor = await loginAs('bacsi@crm-dk.local');
check('đăng nhập admin + bác sĩ', !!(admin.token && doctor.token));

const run = Date.now().toString().slice(-8);
const created = await req('POST', '/patients', {
  token: admin.token,
  body: { firstName: 'Xoá Thử', lastName: 'Nghiệm', dob: '1995-01-01', phone: `09${run}` },
});
check('tạo bệnh nhân cho kịch bản purge', created.status === 201, JSON.stringify(created.body));
const pid = created.body?.id;

// Tạo một lịch hẹn gắn với bệnh nhân này để kiểm chứng nó cũng bị "khoá" sau purge.
const t0 = new Date(Date.now() + 86_400_000 + Math.floor(Math.random() * 200_000) * 1000);
const t1 = new Date(t0.getTime() + 30 * 60_000);
const appt = await req('POST', '/appointments', {
  token: doctor.token,
  body: { patientId: pid, doctorId: doctor.user.id, scheduledStart: t0.toISOString(), scheduledEnd: t1.toISOString(), reason: 'Khám thử để test purge' },
});
check('tạo lịch hẹn cho bệnh nhân thử', appt.status === 201, JSON.stringify(appt.body));
const apptId = appt.body?.id;

console.log('\n--- 1. Không được purge khi chưa soft-delete ---');
const purgeBeforeDelete = await req('POST', `/patients/${pid}/purge`, { token: admin.token, body: { reason: 'Thử nghiệm quy trình xoá an toàn cho mục đích kiểm thử' } });
check('purge khi chưa xoá bị chặn → 409', purgeBeforeDelete.status === 409, `status=${purgeBeforeDelete.status}`);

console.log('\n--- 2. RBAC: chỉ admin được purge ---');
const del = await req('DELETE', `/patients/${pid}`, { token: admin.token });
check('soft-delete thành công → 204', del.status === 204, `status=${del.status}`);

const purgeByDoctor = await req('POST', `/patients/${pid}/purge`, { token: doctor.token, body: { reason: 'Bác sĩ thử tự ý tiêu huỷ, phải bị chặn' } });
check('bác sĩ KHÔNG được purge → 403', purgeByDoctor.status === 403, `status=${purgeByDoctor.status}`);

const doctorSeesTrash = await req('GET', '/patients/deleted', { token: doctor.token });
check('bác sĩ KHÔNG xem được danh sách đã xoá → 403', doctorSeesTrash.status === 403, `status=${doctorSeesTrash.status}`);

console.log('\n--- 3. Thời gian ân hạn ---');
const tooSoon = await req('POST', `/patients/${pid}/purge`, { token: admin.token, body: { reason: 'Thử tiêu huỷ ngay sau khi xoá, phải bị chặn vì chưa đủ ân hạn' } });
check('purge ngay sau khi xoá bị chặn (chưa đủ ân hạn) → 409', tooSoon.status === 409, `status=${tooSoon.status}`);
check('thông báo lỗi nêu rõ đang chờ ân hạn', /chờ thêm|ân hạn/.test(tooSoon.body?.error?.message ?? ''), tooSoon.body?.error?.message);

console.log('\n--- 4. Danh sách "đã xoá" trước khi purge ---');
const trash1 = await req('GET', '/patients/deleted?pageSize=100', { token: admin.token });
const entry1 = trash1.body?.data?.find((d) => d.id === pid);
check('bệnh nhân xuất hiện trong danh sách đã xoá', !!entry1, JSON.stringify(entry1));
check('tên vẫn đọc được (chưa purge)', entry1?.displayName === 'Xoá Thử Nghiệm', entry1?.displayName);
check('cờ isPurgeEligible = false (chưa đủ ân hạn)', entry1?.isPurgeEligible === false);

console.log('\n--- 5. Đẩy thời điểm xoá lùi quá khứ để qua ân hạn ---');
// Test này KHÔNG giả kết quả — chỉnh đúng dữ liệu đầu vào (deleted_at) rồi để
// chính logic tính ân hạn của service tự quyết định qua/không qua.
sql(`UPDATE patients SET deleted_at = now() - interval '2 hours' WHERE id = '${pid}'`);

const trash2 = await req('GET', '/patients/deleted?pageSize=100', { token: admin.token });
const entry2 = trash2.body?.data?.find((d) => d.id === pid);
check('sau khi lùi thời gian, cờ isPurgeEligible = true', entry2?.isPurgeEligible === true);

console.log('\n--- 6. Purge thành công ---');
const purge = await req('POST', `/patients/${pid}/purge`, { token: admin.token, body: { reason: 'Bệnh nhân test được tạo cho mục đích kiểm thử, không phải hồ sơ thật' } });
check('purge thành công → 204', purge.status === 204, `status=${purge.status}`);

const missingReason = await req('DELETE', `/patients/${pid}`, { token: admin.token });
void missingReason; // đã xoá rồi, chỉ để chắc không crash khi gọi lại — không assert

const dbState = sql(`SELECT purged_at IS NOT NULL, purged_reason, ek.status FROM patients p JOIN encryption_keys ek ON ek.id = p.dek_id WHERE p.id = '${pid}'`);
const [purgedFlag, purgedReason, keyStatus] = dbState.split('|');
check('DB: purged_at đã được ghi', purgedFlag === 't', dbState);
check('DB: lý do purge được lưu lại', purgedReason?.includes('kiểm thử'), purgedReason);
check('DB: trạng thái khoá mã hoá = destroyed', keyStatus === 'destroyed', keyStatus);

const wrappedIsZero = sql(`SELECT wrapped_dek = decode(repeat('00', 32), 'hex') FROM encryption_keys WHERE id = (SELECT dek_id FROM patients WHERE id = '${pid}')`);
check('DB: wrapped_dek đã bị ghi đè bằng zero', wrappedIsZero === 't', wrappedIsZero);

console.log('\n--- 7. Sau khi purge: đọc dữ liệu liên quan trả 410, không phải 500 ---');
const apptAfterPurge = await req('GET', `/appointments/${apptId}`, { token: doctor.token });
check('GET lịch hẹn của bệnh nhân đã purge → 410 (không phải 500)', apptAfterPurge.status === 410, `status=${apptAfterPurge.status}`);
check('mã lỗi đúng ngữ nghĩa DATA_DESTROYED', apptAfterPurge.body?.error?.code === 'DATA_DESTROYED', JSON.stringify(apptAfterPurge.body));

console.log('\n--- 8. Không purge được lần hai ---');
const purgeTwice = await req('POST', `/patients/${pid}/purge`, { token: admin.token, body: { reason: 'Thử purge lần hai, phải bị chặn vì đã tiêu huỷ trước đó rồi' } });
check('purge lần hai bị chặn → 409', purgeTwice.status === 409, `status=${purgeTwice.status}`);

console.log('\n--- 9. Danh sách "đã xoá" sau khi purge ---');
const trash3 = await req('GET', '/patients/deleted?pageSize=100', { token: admin.token });
const entry3 = trash3.body?.data?.find((d) => d.id === pid);
check('tên hiển thị placeholder sau khi purge', entry3?.displayName === '[Đã tiêu huỷ vĩnh viễn]', entry3?.displayName);
check('purgedByName ghi đúng người thực hiện', entry3?.purgedByName === 'Quản Trị Viên', entry3?.purgedByName);

console.log('\n--- 10. Validation lý do purge ---');
const created2 = await req('POST', '/patients', { token: admin.token, body: { firstName: 'Xoá Thử 2', lastName: 'Nghiệm', dob: '1990-01-01' } });
await req('DELETE', `/patients/${created2.body.id}`, { token: admin.token });
sql(`UPDATE patients SET deleted_at = now() - interval '2 hours' WHERE id = '${created2.body.id}'`);
const shortReason = await req('POST', `/patients/${created2.body.id}/purge`, { token: admin.token, body: { reason: 'ngắn' } });
check('lý do quá ngắn bị chặn → 400', shortReason.status === 400, `status=${shortReason.status}`);

console.log('\n--- 11. Nhật ký kiểm toán ghi nhận đầy đủ ---');
const logs = await req('GET', '/audit/logs?pageSize=200', { token: admin.token });
const actions = (logs.body?.data ?? []).map((l) => l.action);
check('có ghi PATIENT_PURGE', actions.includes('PATIENT_PURGE'));

console.log(`\n${'='.repeat(46)}\n  KẾT QUẢ PURGE: ${pass} pass, ${fail} fail\n${'='.repeat(46)}\n`);
process.exit(fail > 0 ? 1 : 0);
