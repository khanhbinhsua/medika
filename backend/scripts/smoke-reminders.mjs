import { authenticator } from 'otplib';
import { execFileSync } from 'node:child_process';

const BASE = 'http://localhost:4100/api';
const MAILHOG = 'http://localhost:8025/api/v2';
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

function sql(query) {
  return execFileSync('docker', ['exec', 'crm-dk-postgres', 'psql', '-U', 'crm_app', '-d', 'crm_dk', '-t', '-A', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

const PWD = 'DevPassword123!';

/** Giải mã quoted-printable + MIME encoded-word để kiểm tra nội dung THẬT. */
function decodeQuotedPrintable(s) {
  return s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function decodeMime(s) {
  // encoded-word: =?UTF-8?Q?...?= (nhiều đoạn, phân tách bằng khoảng trắng)
  const joined = s.replace(/\?=\s+=\?UTF-8\?Q\?/gi, '');
  const inner = joined.replace(/=\?UTF-8\?Q\?/gi, '').replace(/\?=/g, '').replace(/_/g, ' ');
  return Buffer.from(decodeQuotedPrintable(inner), 'binary').toString('utf8');
}
function decodeBody(s) {
  return Buffer.from(decodeQuotedPrintable(s), 'binary').toString('utf8');
}

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

// Xoá sạch hộp thư Mailhog để test không lẫn với email cũ.
// Endpoint xoá-tất-cả nằm ở API v1, không phải v2.
async function clearMailhog() {
  await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => {});
}
async function mailhogMessages() {
  const res = await fetch(`${MAILHOG}/messages`);
  return (await res.json()).items ?? [];
}

console.log('\n--- Chuẩn bị ---');
await clearMailhog();
const admin = await loginAs('admin@crm-dk.local');
const doctor = await loginAs('bacsi@crm-dk.local');
const reception = await loginAs('letan@crm-dk.local');
check('đăng nhập admin/bác sĩ/lễ tân', !!(admin.token && doctor.token && reception.token));

const run = Date.now().toString().slice(-8);
const uniqueEmail = `benhnhan.${run}@example.com`;
const patient = await req('POST', '/patients', {
  token: admin.token,
  body: { firstName: 'Nhắc Lịch', lastName: 'Thử', dob: '1990-03-03', email: uniqueEmail, phone: `09${run}` },
});
check('tạo bệnh nhân (có email + sđt)', patient.status === 201, JSON.stringify(patient.body));
const pid = patient.body?.id;
const doctorId = doctor.user.id;

console.log('\n--- 1. Tự tạo reminder khi đặt lịch (>lead time) ---');
// Mỗi lần chạy chọn một "vùng" thời gian riêng CÁCH NHIỀU NĂM ở tương lai
// (100–4000 ngày) để không đụng ràng buộc chống trùng giờ với lịch của các lần
// chạy trước (bác sĩ dev tích luỹ hàng trăm lịch). Vẫn > lead time 24h nên
// reminder được tạo bình thường.
const farBaseDays = 100 + Math.floor(Math.random() * 3900);
const t0 = new Date(Date.now() + farBaseDays * 86400_000 + Math.floor(Math.random() * 80000) * 1000);
t0.setSeconds(0, 0);
const appt = await req('POST', '/appointments', {
  token: reception.token,
  body: { patientId: pid, doctorId, scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 1800_000).toISOString(), room: 'P.105' },
});
check('đặt lịch hẹn 48h tới → 201', appt.status === 201, JSON.stringify(appt.body));
const apptId = appt.body?.id;

const reminders = await req('GET', `/reminders/appointment/${apptId}`, { token: doctor.token });
check('đã tự tạo 2 reminder (email + sms)', reminders.body?.length === 2, `got ${reminders.body?.length}`);
check('cả hai đang chờ (pending)', reminders.body?.every((r) => r.status === 'pending'));
const channels = new Set(reminders.body?.map((r) => r.channel));
check('có đủ kênh email và sms', channels.has('email') && channels.has('sms'), [...channels].join(','));

console.log('\n--- 2. Lịch quá gần (<lead time) không tạo reminder ---');
// Phải <24h (mốc nhắc ở quá khứ → không tạo reminder), nhưng vùng gần hiện tại
// đông lịch từ các lần chạy trước nên dễ trùng giờ. Thử vài khung 1h–23h khác
// nhau cho tới khi đặt được — trùng giờ ở đây là dữ liệu tích luỹ, không phải lỗi.
let apptSoon;
for (let attempt = 0; attempt < 15; attempt++) {
  const soon = new Date(Date.now() + 3600_000 + Math.floor(Math.random() * 79200) * 1000);
  soon.setSeconds(0, 0);
  apptSoon = await req('POST', '/appointments', {
    token: reception.token,
    body: { patientId: pid, doctorId, scheduledStart: soon.toISOString(), scheduledEnd: new Date(soon.getTime() + 1800_000).toISOString() },
  });
  if (apptSoon.status === 201) break;
}
check('đặt được lịch gần (<24h) sau vài lần thử', apptSoon.status === 201, JSON.stringify(apptSoon.body));
const remSoon = await req('GET', `/reminders/appointment/${apptSoon.body?.id}`, { token: doctor.token });
check('lịch <24h tới → KHÔNG tạo reminder', Array.isArray(remSoon.body) && remSoon.body.length === 0, `got ${JSON.stringify(remSoon.body)}`);

console.log('\n--- 3. Bệnh nhân không có liên hệ → không reminder ---');
const noContact = await req('POST', '/patients', { token: admin.token, body: { firstName: 'Không', lastName: 'Liên Hệ', dob: '1985-05-05' } });
const ncStart = new Date(Date.now() + (100 + Math.floor(Math.random() * 3900)) * 86400_000 + Math.floor(Math.random() * 80000) * 1000);
const apptNC = await req('POST', '/appointments', {
  token: reception.token,
  body: { patientId: noContact.body.id, doctorId, scheduledStart: ncStart.toISOString(), scheduledEnd: new Date(ncStart.getTime() + 1800_000).toISOString() },
});
const remNC = await req('GET', `/reminders/appointment/${apptNC.body.id}`, { token: doctor.token });
check('bệnh nhân không email/sđt → 0 reminder', remNC.body?.length === 0, `got ${remNC.body?.length}`);

console.log('\n--- 4. Đẩy mốc nhắc về quá khứ rồi điều phối gửi ---');
// Không giả kết quả: chỉnh scheduled_for về quá khứ (mô phỏng thời gian trôi),
// để chính bộ điều phối tự quyết định gửi.
sql(`UPDATE appointment_reminders SET scheduled_for = now() - interval '1 minute' WHERE appointment_id = '${apptId}'`);

const dispatch = await req('POST', '/reminders/dispatch', { token: admin.token });
check('điều phối chạy được → 200', dispatch.status === 200, JSON.stringify(dispatch.body));
check('gửi đúng 2 reminder', dispatch.body?.sent === 2, JSON.stringify(dispatch.body));

const remAfter = await req('GET', `/reminders/appointment/${apptId}`, { token: doctor.token });
check('cả 2 reminder chuyển sang sent', remAfter.body?.every((r) => r.status === 'sent'), JSON.stringify(remAfter.body));
check('có ghi thời điểm gửi', remAfter.body?.every((r) => !!r.sentAt));

console.log('\n--- 5. Email thật vào Mailhog + không chứa PHI ---');
await new Promise((r) => setTimeout(r, 500));
const mails = await mailhogMessages();
check('Mailhog nhận đúng 1 email', mails.length === 1, `got ${mails.length}`);
const mail = mails[0];
const toAddr = mail?.Content?.Headers?.To?.[0] ?? '';
check('email gửi đúng địa chỉ bệnh nhân', toAddr.includes(uniqueEmail), toAddr);
const subject = decodeMime(mail?.Content?.Headers?.Subject?.[0] ?? '');
check('tiêu đề là nhắc lịch hẹn', /[Nn]hắc lịch/.test(subject), subject);
const body = decodeBody(mail?.Content?.Body ?? '');
check('nội dung có lời nhắc lịch hẹn', /lịch hẹn khám/.test(body), body.slice(0, 80));
// PHI KHÔNG được lọt vào email (kênh không mã hoá): tên bệnh nhân, lý do khám...
const phiLeak = ['Nhắc Lịch Thử', 'BS. Nguyễn', uniqueEmail.split('@')[0]].filter((s) => body.includes(s));
check('email KHÔNG chứa tên bệnh nhân / bác sĩ (PHI)', phiLeak.length === 0, `lộ: ${phiLeak.join(', ')}`);

console.log('\n--- 6. Điều phối lần hai không gửi trùng ---');
const dispatch2 = await req('POST', '/reminders/dispatch', { token: admin.token });
check('lần hai không còn gì để gửi', dispatch2.body?.sent === 0, JSON.stringify(dispatch2.body));
const mails2 = await mailhogMessages();
check('Mailhog vẫn chỉ 1 email (không gửi lại)', mails2.length === 1, `got ${mails2.length}`);

console.log('\n--- 7. Lịch huỷ → reminder tự huỷ khi điều phối ---');
const t2 = new Date(Date.now() + (100 + Math.floor(Math.random() * 3900)) * 86400_000 + Math.floor(Math.random() * 80000) * 1000);
const apptCancel = await req('POST', '/appointments', {
  token: reception.token,
  body: { patientId: pid, doctorId, scheduledStart: t2.toISOString(), scheduledEnd: new Date(t2.getTime() + 1800_000).toISOString() },
});
sql(`UPDATE appointment_reminders SET scheduled_for = now() - interval '1 minute' WHERE appointment_id = '${apptCancel.body.id}'`);
await req('POST', `/appointments/${apptCancel.body.id}/cancel`, { token: reception.token, body: { reason: 'Bệnh nhân bận' } });
const dispatch3 = await req('POST', '/reminders/dispatch', { token: admin.token });
check('reminder của lịch đã huỷ → bị huỷ, không gửi', dispatch3.body?.cancelled >= 1 && dispatch3.body?.sent === 0, JSON.stringify(dispatch3.body));

console.log('\n--- 8. RBAC ---');
const receptionDispatch = await req('POST', '/reminders/dispatch', { token: reception.token });
check('lễ tân KHÔNG điều phối được → 403', receptionDispatch.status === 403, `status=${receptionDispatch.status}`);

console.log('\n--- 9. Audit + không rò rỉ PHI trong nhật ký ---');
const logs = await req('GET', '/audit/logs?pageSize=200', { token: admin.token });
const actions = (logs.body?.data ?? []).map((l) => l.action);
check('có ghi REMINDER_SENT', actions.includes('REMINDER_SENT'));
check('có ghi REMINDER_DISPATCH_MANUAL', actions.includes('REMINDER_DISPATCH_MANUAL'));
const rawLogs = JSON.stringify(logs.body);
check('nhật ký không lộ tên bệnh nhân', !rawLogs.includes('Nhắc Lịch Thử'));

console.log(`\n${'='.repeat(46)}\n  KẾT QUẢ REMINDERS: ${pass} pass, ${fail} fail\n${'='.repeat(46)}\n`);
process.exit(fail > 0 ? 1 : 0);
