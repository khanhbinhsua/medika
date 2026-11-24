import { authenticator } from 'otplib';

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

const PWD = 'DevPassword123!';

/** Đăng nhập đầy đủ gồm cả bước đăng ký MFA lần đầu. */
async function loginAs(email) {
  const first = await req('POST', '/auth/login', { body: { email, password: PWD } });
  if (first.body?.mfaEnrollmentRequired) {
    const token = first.body.enrollmentToken;
    const start = await req('POST', '/auth/mfa/enroll/start', { body: { enrollmentToken: token } });
    const secret = new URL(start.body.otpauthUrl).searchParams.get('secret');
    const done = await req('POST', '/auth/mfa/enroll/confirm', {
      body: { enrollmentToken: token, code: authenticator.generate(secret) },
    });
    return { token: done.body?.accessToken, user: done.body?.user };
  }
  throw new Error(`${email}: cần chạy "npm run dev:reset-mfa" trước`);
}

console.log('\n--- Chuẩn bị: đăng nhập các vai trò ---');
const admin = await loginAs('admin@crm-dk.local');
const doctor = await loginAs('bacsi@crm-dk.local');
const nurse = await loginAs('yta@crm-dk.local');
const reception = await loginAs('letan@crm-dk.local');
check('4 vai trò đăng nhập được', !!(admin.token && doctor.token && nurse.token && reception.token));

const run = Date.now().toString().slice(-8);
const patient = await req('POST', '/patients', {
  token: admin.token,
  body: { firstName: 'Trần Thị', lastName: 'Mai', dob: '1990-07-21', gender: 'female', phone: `08${run}` },
});
check('tạo bệnh nhân cho kịch bản', patient.status === 201, JSON.stringify(patient.body));
const pid = patient.body?.id;
const doctorId = doctor.user?.id;

console.log('\n--- 1. Tạo lịch hẹn + mã hoá lý do khám ---');
// Mỗi lần chạy chiếm một khung giờ riêng trong tương lai. Ràng buộc chống trùng
// giờ là vĩnh viễn ở tầng DB, nên dùng lại khung giờ cũ sẽ bị chặn đúng theo
// thiết kế — và làm hỏng cả kịch bản test phía sau.
const slotOffsetMinutes = Math.floor(Math.random() * 300_000);
const t0 = new Date(Date.now() + 86_400_000 + slotOffsetMinutes * 60_000);
t0.setSeconds(0, 0);
const t1 = new Date(t0.getTime() + 30 * 60_000);

const appt = await req('POST', '/appointments', {
  token: reception.token,
  body: {
    patientId: pid, doctorId,
    scheduledStart: t0.toISOString(), scheduledEnd: t1.toISOString(),
    room: 'P.204', reason: 'Đau ngực trái, khó thở khi gắng sức',
  },
});
check('lễ tân đặt được lịch hẹn → 201', appt.status === 201, JSON.stringify(appt.body));
check('lý do khám giải mã đúng', appt.body?.reason === 'Đau ngực trái, khó thở khi gắng sức', appt.body?.reason);
check('trả kèm tên bệnh nhân đã giải mã', appt.body?.patientName === 'Trần Thị Mai', appt.body?.patientName);
check('trạng thái khởi tạo là scheduled', appt.body?.status === 'scheduled', appt.body?.status);
const apptId = appt.body?.id;

console.log('\n--- 2. Chống double-booking ---');
const overlap = await req('POST', '/appointments', {
  token: reception.token,
  body: {
    patientId: pid, doctorId,
    scheduledStart: new Date(t0.getTime() + 10 * 60_000).toISOString(),
    scheduledEnd: new Date(t1.getTime() + 10 * 60_000).toISOString(),
  },
});
check('lịch chồng giờ cùng bác sĩ bị chặn → 409', overlap.status === 409, `status=${overlap.status}`);
check('thông báo lỗi dễ hiểu', /trùng khung giờ/.test(overlap.body?.error?.message ?? ''), overlap.body?.error?.message);

const adjacent = await req('POST', '/appointments', {
  token: reception.token,
  body: { patientId: pid, doctorId, scheduledStart: t1.toISOString(), scheduledEnd: new Date(t1.getTime() + 30 * 60_000).toISOString() },
});
check('lịch liền kề (không chồng) vẫn đặt được', adjacent.status === 201, `status=${adjacent.status}`);

console.log('\n--- 3. Máy trạng thái lịch hẹn ---');
const badJump = await req('POST', `/appointments/${apptId}/status`, { token: reception.token, body: { status: 'completed' } });
check('nhảy thẳng scheduled → completed bị chặn → 409', badJump.status === 409, `status=${badJump.status}`);

const s1 = await req('POST', `/appointments/${apptId}/status`, { token: reception.token, body: { status: 'checked_in' } });
check('scheduled → checked_in được', s1.body?.status === 'checked_in', JSON.stringify(s1.body));
check('ghi lại mốc giờ đến', !!s1.body?.checkedInAt);

const s2 = await req('POST', `/appointments/${apptId}/status`, { token: doctor.token, body: { status: 'in_progress' } });
check('checked_in → in_progress được', s2.body?.status === 'in_progress', s2.body?.status);
const s3 = await req('POST', `/appointments/${apptId}/status`, { token: doctor.token, body: { status: 'completed' } });
check('in_progress → completed được', s3.body?.status === 'completed', s3.body?.status);

const afterDone = await req('PATCH', `/appointments/${apptId}`, { token: reception.token, body: { room: 'P.999' } });
check('lịch đã hoàn thành không sửa được → 409', afterDone.status === 409, `status=${afterDone.status}`);

console.log('\n--- 4. Huỷ lịch ---');
const cancel = await req('POST', `/appointments/${adjacent.body.id}/cancel`, {
  token: reception.token, body: { reason: 'Bệnh nhân báo bận đột xuất' },
});
check('lễ tân huỷ được lịch', cancel.body?.status === 'cancelled', JSON.stringify(cancel.body));
check('lý do huỷ được mã hoá và giải mã đúng', cancel.body?.cancelReason === 'Bệnh nhân báo bận đột xuất', cancel.body?.cancelReason);
const cancelTwice = await req('POST', `/appointments/${adjacent.body.id}/cancel`, { token: reception.token, body: { reason: 'lần hai' } });
check('huỷ lại lần hai bị chặn → 409', cancelTwice.status === 409, `status=${cancelTwice.status}`);

console.log('\n--- 5. Hồ sơ y tế + phiên bản ---');
const rec = await req('POST', '/records', {
  token: doctor.token,
  body: {
    patientId: pid, appointmentId: apptId, recordType: 'consultation',
    title: 'Khám tim mạch lần đầu',
    content: 'Bệnh nhân đau ngực trái 3 ngày. Huyết áp 140/90. Chỉ định điện tim.',
    icd10Code: 'I20.9',
  },
});
check('bác sĩ tạo được hồ sơ → 201', rec.status === 201, JSON.stringify(rec.body));
check('nội dung giải mã đúng', /Huyết áp 140\/90/.test(rec.body?.content ?? ''), rec.body?.content);
check('phiên bản khởi tạo = 1', rec.body?.version === 1, String(rec.body?.version));
const recId = rec.body?.id;

const badIcd = await req('POST', '/records', {
  token: doctor.token,
  body: { patientId: pid, title: 'x', content: 'y', icd10Code: 'SAI-MA' },
});
check('mã ICD-10 sai định dạng bị chặn → 400', badIcd.status === 400, `status=${badIcd.status}`);

const noReason = await req('PATCH', `/records/${recId}`, { token: doctor.token, body: { content: 'sửa lén' } });
check('sửa hồ sơ mà không nêu lý do → 400', noReason.status === 400, `status=${noReason.status}`);

const upd = await req('PATCH', `/records/${recId}`, {
  token: doctor.token,
  body: { content: 'Bệnh nhân đau ngực trái 3 ngày. Điện tim: ST chênh nhẹ V4-V6.', changeReason: 'Bổ sung kết quả điện tim' },
});
check('sửa kèm lý do → thành công', upd.status === 200, JSON.stringify(upd.body));
check('phiên bản tăng lên 2', upd.body?.version === 2, String(upd.body?.version));

const vers = await req('GET', `/records/${recId}/versions`, { token: doctor.token });
check('lịch sử giữ đúng 1 bản cũ', vers.body?.length === 1, `got ${vers.body?.length}`);
check('bản cũ giữ nguyên nội dung gốc', /Chỉ định điện tim/.test(vers.body?.[0]?.content ?? ''), vers.body?.[0]?.content);
check('bản cũ lưu lý do sửa', vers.body?.[0]?.changeReason === 'Bổ sung kết quả điện tim', vers.body?.[0]?.changeReason);

console.log('\n--- 6. Ký hồ sơ ---');
const signOther = await req('POST', `/records/${recId}/sign`, { token: admin.token });
check('người khác không ký thay được → 403', signOther.status === 403, `status=${signOther.status}`);
const sign = await req('POST', `/records/${recId}/sign`, { token: doctor.token });
check('người lập ký được → 204', sign.status === 204, `status=${sign.status}`);
const editSigned = await req('PATCH', `/records/${recId}`, { token: doctor.token, body: { content: 'sửa sau ký', changeReason: 'thử' } });
check('hồ sơ đã ký không sửa được → 409', editSigned.status === 409, `status=${editSigned.status}`);

console.log('\n--- 7. Đơn thuốc + RBAC ---');
const rx = await req('POST', '/prescriptions', {
  token: doctor.token,
  body: {
    patientId: pid, recordId: recId, medication: 'Aspirin', dosage: '81mg',
    frequency: '1 lần/ngày sau ăn sáng', durationDays: 30, instructions: 'Uống với nhiều nước, theo dõi dấu hiệu xuất huyết',
  },
});
check('bác sĩ kê được đơn → 201', rx.status === 201, JSON.stringify(rx.body));
check('hướng dẫn dùng thuốc giải mã đúng', /theo dõi dấu hiệu xuất huyết/.test(rx.body?.instructions ?? ''), rx.body?.instructions);
check('hạn đơn tính từ số ngày', !!rx.body?.expiresAt);

const nurseRx = await req('POST', '/prescriptions', {
  token: nurse.token,
  body: { patientId: pid, medication: 'Paracetamol', dosage: '500mg', frequency: '3 lần/ngày' },
});
check('y tá KHÔNG được kê đơn → 403', nurseRx.status === 403, `status=${nurseRx.status}`);

const nurseRead = await req('GET', `/prescriptions?patientId=${pid}`, { token: nurse.token });
check('y tá vẫn xem được đơn thuốc', nurseRead.status === 200 && nurseRead.body?.length === 1, `status=${nurseRead.status}`);

console.log('\n--- 8. RBAC lễ tân với hồ sơ bệnh án ---');
const recReadByReception = await req('GET', `/records?patientId=${pid}`, { token: reception.token });
check('lễ tân KHÔNG xem được hồ sơ bệnh án → 403', recReadByReception.status === 403, `status=${recReadByReception.status}`);

console.log('\n--- 9. Chống trộn lẫn bệnh án ---');
const other = await req('POST', '/patients', {
  token: admin.token,
  body: { firstName: 'Lê Văn', lastName: 'Bình', dob: '1975-01-01' },
});
const mismatch = await req('POST', '/records', {
  token: doctor.token,
  body: { patientId: other.body.id, appointmentId: apptId, title: 'Sai bệnh nhân', content: 'x' },
});
check('gắn hồ sơ vào lịch hẹn của bệnh nhân khác bị chặn → 409', mismatch.status === 409, `status=${mismatch.status}`);

console.log('\n--- 10. Lọc danh sách lịch hẹn ---');
const byPatient = await req('GET', `/appointments?patientId=${pid}`, { token: doctor.token });
check('lọc theo bệnh nhân trả đúng 2 lịch', byPatient.body?.data?.length === 2, `got ${byPatient.body?.data?.length}`);
const byStatus = await req('GET', `/appointments?patientId=${pid}&status=cancelled`, { token: doctor.token });
check('lọc theo trạng thái trả đúng 1 lịch', byStatus.body?.data?.length === 1, `got ${byStatus.body?.data?.length}`);

console.log(`\n${'='.repeat(46)}\n  KẾT QUẢ PHASE 2: ${pass} pass, ${fail} fail\n${'='.repeat(46)}\n`);
process.exit(fail > 0 ? 1 : 0);
