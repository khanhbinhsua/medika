import { authenticator } from 'otplib';

const BASE = 'http://localhost:4100/api';
let pass = 0, fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

async function req(method, path, { body, token, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, body: json };
}

const PWD = 'DevPassword123!';
async function loginAs(email) {
  const first = await req('POST', '/auth/login', { body: { email, password: PWD } });
  if (!first.body?.mfaEnrollmentRequired) throw new Error(`${email}: cần chạy "npm run dev:reset-mfa" trước`);
  const token = first.body.enrollmentToken;
  const start = await req('POST', '/auth/mfa/enroll/start', { body: { enrollmentToken: token } });
  const secret = new URL(start.body.otpauthUrl).searchParams.get('secret');
  const done = await req('POST', '/auth/mfa/enroll/confirm', { body: { enrollmentToken: token, code: authenticator.generate(secret) } });
  return { token: done.body?.accessToken, user: done.body?.user };
}

console.log('\n--- Chuẩn bị ---');
const admin = await loginAs('admin@crm-dk.local');
const doctor = await loginAs('bacsi@crm-dk.local');
const nurse = await loginAs('yta@crm-dk.local');
check('đăng nhập admin/bác sĩ/y tá', !!(admin.token && doctor.token && nurse.token));

console.log('\n--- 1. Tổng quan ---');
const ov = await req('GET', '/reports/overview', { token: admin.token });
check('lấy được số liệu tổng quan → 200', ov.status === 200, JSON.stringify(ov.body));
const keys = ['activePatients', 'newPatientsLast30d', 'appointmentsUpcoming', 'activePrescriptions', 'documentsTotal'];
check('có đủ các chỉ số', keys.every((k) => typeof ov.body?.[k] === 'number'), JSON.stringify(ov.body));
check('số bệnh nhân đang theo dõi > 0 (đã có dữ liệu test)', ov.body?.activePatients > 0, `got ${ov.body?.activePatients}`);

console.log('\n--- 2. Phân bố lịch hẹn theo trạng thái ---');
const byStatus = await req('GET', '/reports/appointments/by-status', { token: admin.token });
check('trả về mảng phân bố', Array.isArray(byStatus.body), JSON.stringify(byStatus.body).slice(0, 100));
check('mỗi mục có status + count', (byStatus.body ?? []).every((r) => typeof r.status === 'string' && typeof r.count === 'number'));

console.log('\n--- 3. Xu hướng theo ngày ---');
const timeline = await req('GET', '/reports/appointments/timeline', { token: admin.token });
check('trả về mảng điểm theo ngày', Array.isArray(timeline.body));
check('mỗi điểm có day + total', (timeline.body ?? []).every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.day) && typeof p.total === 'number'), JSON.stringify(timeline.body?.[0]));

console.log('\n--- 4. Năng suất bác sĩ ---');
const prod = await req('GET', '/reports/provider-productivity', { token: admin.token });
check('trả về mảng năng suất', Array.isArray(prod.body));
const bs = (prod.body ?? []).find((d) => d.doctorName?.includes('Nguyễn Văn An'));
check('có bác sĩ trong danh sách', !!bs, JSON.stringify(prod.body?.[0]));
check('có các chỉ số năng suất', bs && ['appointments', 'completed', 'prescriptions'].every((k) => typeof bs[k] === 'number'));

console.log('\n--- 5. RBAC đọc báo cáo ---');
const nurseRead = await req('GET', '/reports/overview', { token: nurse.token });
check('y tá KHÔNG xem được báo cáo → 403', nurseRead.status === 403, `status=${nurseRead.status}`);
const doctorRead = await req('GET', '/reports/overview', { token: doctor.token });
check('bác sĩ xem được báo cáo → 200', doctorRead.status === 200, `status=${doctorRead.status}`);

console.log('\n--- 6. Xuất CSV + RBAC export ---');
const doctorExport = await req('GET', '/reports/export/provider-productivity.csv', { token: doctor.token, raw: true });
check('bác sĩ KHÔNG xuất được (thiếu report:export) → 403', doctorExport.status === 403, `status=${doctorExport.status}`);

const csv = await req('GET', '/reports/export/provider-productivity.csv', { token: admin.token, raw: true });
check('admin xuất CSV → 200', csv.status === 200, `status=${csv.status}`);
check('Content-Type là text/csv', (csv.headers?.get('content-type') ?? '').includes('text/csv'), csv.headers?.get('content-type'));
check('có Content-Disposition attachment', (csv.headers?.get('content-disposition') ?? '').includes('attachment'), csv.headers?.get('content-disposition'));

// BOM phải kiểm trên BYTES thô: fetch.text() tự nuốt BOM khi decode UTF-8,
// nên đọc arrayBuffer và xem 3 byte đầu có đúng EF BB BF không.
const bomRes = await fetch(`${BASE}/reports/export/provider-productivity.csv`, { headers: { Authorization: `Bearer ${admin.token}` } });
const bomBytes = Buffer.from(await bomRes.arrayBuffer()).subarray(0, 3).toString('hex');
check('CSV có BOM UTF-8 (Excel đọc đúng tiếng Việt)', bomBytes === 'efbbbf', `3 byte đầu=${bomBytes}`);
check('CSV có dòng tiêu đề đúng', csv.text?.includes('Bác sĩ') && csv.text?.includes('Tổng lịch hẹn'), csv.text?.split('\r\n')[0]);
check('CSV có tên bác sĩ (nhân sự, không phải PHI)', /Nguyễn Văn An/.test(csv.text ?? ''));

console.log('\n--- 7. CSV KHÔNG chứa PHI bệnh nhân ---');
const timelineCsv = await req('GET', '/reports/export/appointments-timeline.csv', { token: admin.token, raw: true });
check('xuất CSV xu hướng → 200', timelineCsv.status === 200);
// Báo cáo tổng hợp: KHÔNG được có tên bệnh nhân, MRN, hay bất kỳ định danh cá nhân nào.
const phiPatterns = ['BN-2026-', 'Nhắc Lịch Thử', 'Trần Thị Mai', 'Xét Nghiệm Thử', '@example.com'];
const bothCsv = (csv.text ?? '') + (timelineCsv.text ?? '');
const leaks = phiPatterns.filter((p) => bothCsv.includes(p));
check('CSV KHÔNG chứa định danh bệnh nhân', leaks.length === 0, `lộ: ${leaks.join(', ')}`);

console.log('\n--- 8. Lọc khoảng thời gian ---');
// Cửa sổ CỰC xa (10000–11000 ngày ~ 27+ năm) để chắc chắn rỗng — xa hơn mọi
// slot mà các smoke test khác có thể tạo (reminder test đặt lịch tới ~4000 ngày).
const narrow = await req('GET', `/reports/appointments/by-status?from=${new Date(Date.now() + 10000 * 86400000).toISOString()}&to=${new Date(Date.now() + 11000 * 86400000).toISOString()}`, { token: admin.token });
check('khoảng thời gian cực xa trong tương lai → rỗng', Array.isArray(narrow.body) && narrow.body.length === 0, JSON.stringify(narrow.body));

console.log('\n--- 9. Audit ghi nhận xuất báo cáo ---');
const logs = await req('GET', '/audit/logs?pageSize=100', { token: admin.token });
const actions = (logs.body?.data ?? []).map((l) => l.action);
check('có ghi REPORT_EXPORT', actions.includes('REPORT_EXPORT'));

console.log(`\n${'='.repeat(46)}\n  KẾT QUẢ REPORTS: ${pass} pass, ${fail} fail\n${'='.repeat(46)}\n`);
process.exit(fail > 0 ? 1 : 0);
