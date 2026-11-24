import { authenticator } from 'otplib';
import { execFileSync, spawn } from 'node:child_process';

const API_PORT = 4114;
const BASE = `http://localhost:${API_PORT}/api`;
const MAILHOG = 'http://localhost:8025/api/v2';
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

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', 'crm-dk-postgres', 'psql', '-U', 'crm_app', '-d', 'crm_dk', '-t', '-A', '-c', query],
    { encoding: 'utf8' },
  ).trim();
}

function decodeQuotedPrintable(s) {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
async function clearMailhog() {
  await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => {});
}
async function mailhogMessages() {
  const res = await fetch(`${MAILHOG}/messages`);
  return (await res.json()).items ?? [];
}
/** Lấy token khảo sát từ email mới nhất trong Mailhog (link /survey/<token>). */
async function tokenFromMail() {
  // Poll tới ~4s: email vào Mailhog có độ trễ, tránh đọc sớm trả null.
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const mails = await mailhogMessages();
    if (mails.length > 0) {
      const body = decodeQuotedPrintable(mails[0]?.Content?.Body ?? '');
      const m = body.match(/\/survey\/([A-Za-z0-9_-]+)/);
      if (m) return m[1];
    }
  }
  return null;
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

const pub = async (method, token, body) => {
  const res = await fetch(`${BASE}/public/surveys/${token}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

try {
  console.log('\n--- Chuẩn bị: backend riêng (cổng 4114) ---');
  backend = startBackend();
  const healthy = await waitHealthy();
  check('backend khởi động', healthy);
  if (!healthy) throw new Error('backend không lên');

  const admin = await loginAs('admin@crm-dk.local');
  const doctor = await loginAs('bacsi@crm-dk.local');
  const reception = await loginAs('letan@crm-dk.local');
  const auditor = await loginAs('kiemtoan@crm-dk.local');
  check('đăng nhập 4 vai trò', !!(admin.token && doctor.token && reception.token && auditor.token));

  const run = Date.now().toString().slice(-8);
  const mkPatient = (fn) =>
    req('POST', '/patients', { token: admin.token, body: { firstName: fn, lastName: 'KS', dob: '1990-06-06', email: `${fn}.${run}@example.com` } });
  const p1 = (await mkPatient('NPS')).body;
  check('tạo bệnh nhân (email-only)', !!p1?.id);

  console.log('\n--- 1. Tạo & kích hoạt khảo sát NPS ---');
  const survey = await req('POST', '/surveys', { token: admin.token, body: { name: `NPS ${run}`, type: 'nps' } });
  check('tạo khảo sát → 201', survey.status === 201, JSON.stringify(survey.body));
  check('tự sinh câu hỏi mặc định (2)', survey.body?.questions?.length === 2, JSON.stringify(survey.body?.questions?.length));
  const surveyId = survey.body.id;
  const activate = await req('PATCH', `/surveys/${surveyId}`, { token: admin.token, body: { status: 'active' } });
  check('kích hoạt khảo sát', activate.body?.status === 'active');

  console.log('\n--- 2. Gửi lời mời → email chứa link (token) ---');
  await clearMailhog();
  const invite = await req('POST', `/surveys/${surveyId}/invite`, { token: reception.token, body: { patientId: p1.id } });
  check('gửi lời mời → 201, status sent', invite.status === 201 && invite.body?.status === 'sent', JSON.stringify(invite.body));
  const token1 = await tokenFromMail();
  check('lấy được token khảo sát từ email', !!token1, `token=${token1}`);

  console.log('\n--- 3. Xem + trả lời qua link công khai (không đăng nhập) ---');
  const view = await pub('GET', token1);
  check('xem khảo sát công khai (nps, 2 câu)', view.status === 200 && view.body?.type === 'nps' && view.body?.questions?.length === 2, JSON.stringify(view.body));
  check('chưa trả lời', view.body?.alreadyResponded === false);
  const respond = await pub('POST', token1, { score: 3, comment: 'Chờ hơi lâu, cần cải thiện tốc độ.' });
  check('gửi phản hồi điểm thấp → recorded', respond.status === 200 && respond.body?.recorded === true, JSON.stringify(respond.body));
  check('bị chấm cờ tiêu cực (NPS<=6)', respond.body?.isNegative === true);
  const respondAgain = await pub('POST', token1, { score: 8 });
  check('trả lời lại cùng token → 409', respondAgain.status === 409, `status=${respondAgain.status}`);

  console.log('\n--- 4. PHI: góp ý được mã hoá tại chỗ ---');
  const leak = sql(`SELECT count(*) FROM survey_responses WHERE comment_enc::text LIKE '%Chờ hơi lâu%' OR comment_enc::text LIKE '%cai thien%'`);
  check('comment_enc KHÔNG chứa góp ý dạng chữ', leak === '0', `leak=${leak}`);
  const scoreStored = sql(`SELECT score FROM survey_responses WHERE survey_id='${surveyId}'`);
  check('điểm số lưu plaintext để tổng hợp', scoreStored === '3', `score=${scoreStored}`);

  console.log('\n--- 5. Báo cáo NPS + phản hồi tiêu cực ---');
  const report = await req('GET', `/surveys/${surveyId}/report`, { token: doctor.token });
  check('bác sĩ xem báo cáo (chỉ đọc) → 200', report.status === 200, `status=${report.status}`);
  check('NPS: 1 phản hồi, 1 detractor', report.body?.overall?.total === 1 && report.body?.overall?.detractors === 1, JSON.stringify(report.body?.overall));
  check('đếm phản hồi tiêu cực = 1', report.body?.negativeCount === 1, JSON.stringify(report.body?.negativeCount));
  const negatives = await req('GET', `/surveys/${surveyId}/negative`, { token: reception.token });
  check('danh sách tiêu cực giải mã góp ý', negatives.body?.[0]?.comment === 'Chờ hơi lâu, cần cải thiện tốc độ.', JSON.stringify(negatives.body?.[0]));
  check('danh sách tiêu cực có MRN (không tên)', !!negatives.body?.[0]?.mrn);

  console.log('\n--- 6. Gửi khảo sát TỰ ĐỘNG sau lịch hẹn hoàn thành ---');
  const p2 = (await mkPatient('AUTO')).body;
  const t0 = new Date(Date.now() + (200 + Math.floor(Math.random() * 3000)) * 86400_000);
  t0.setSeconds(0, 0);
  const appt = await req('POST', '/appointments', {
    token: reception.token,
    body: { patientId: p2.id, doctorId: doctor.user.id, scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 1800_000).toISOString() },
  });
  for (const st of ['checked_in', 'in_progress', 'completed']) {
    await req('POST', `/appointments/${appt.body.id}/status`, { token: doctor.token, body: { status: st } });
  }
  const dispatch = await req('POST', '/surveys/dispatch-auto', { token: admin.token, body: { surveyId, sinceHours: 720 } });
  check('điều phối tự động → có ứng viên & gửi', dispatch.body?.candidates >= 1 && dispatch.body?.sent >= 1, JSON.stringify(dispatch.body));
  const invForAppt = sql(`SELECT count(*) FROM survey_invitations WHERE survey_id='${surveyId}' AND appointment_id='${appt.body.id}'`);
  check('đã tạo lời mời cho lịch hẹn hoàn thành', invForAppt === '1', `rows=${invForAppt}`);
  const dispatch2 = await req('POST', '/surveys/dispatch-auto', { token: admin.token, body: { surveyId, sinceHours: 720 } });
  const stillOne = sql(`SELECT count(*) FROM survey_invitations WHERE survey_id='${surveyId}' AND appointment_id='${appt.body.id}'`);
  check('điều phối lần 2 KHÔNG gửi trùng lịch hẹn đó', stillOne === '1', `rows=${stillOne} disp2=${JSON.stringify(dispatch2.body)}`);

  console.log('\n--- 7. CSAT: điểm cao không phải tiêu cực ---');
  const csat = await req('POST', '/surveys', { token: admin.token, body: { name: `CSAT ${run}`, type: 'csat' } });
  await req('PATCH', `/surveys/${csat.body.id}`, { token: admin.token, body: { status: 'active' } });
  const p3 = (await mkPatient('CSAT')).body;
  await clearMailhog();
  await req('POST', `/surveys/${csat.body.id}/invite`, { token: admin.token, body: { patientId: p3.id, doctorId: doctor.user.id } });
  const token3 = await tokenFromMail();
  const r3 = await pub('POST', token3, { score: 5, comment: 'Rất hài lòng!' });
  check('CSAT điểm 5 → không tiêu cực', r3.body?.isNegative === false, JSON.stringify(r3.body));
  const csatReport = await req('GET', `/surveys/${csat.body.id}/report`, { token: admin.token });
  check('CSAT: avg 5, hài lòng 100%', csatReport.body?.overall?.avgScore === 5 && csatReport.body?.overall?.satisfiedPercent === 100, JSON.stringify(csatReport.body?.overall));
  check('báo cáo phân rã theo bác sĩ', csatReport.body?.byDoctor?.length >= 1 && csatReport.body.byDoctor[0].doctorId === doctor.user.id, JSON.stringify(csatReport.body?.byDoctor));
  // Validate điểm ngoài thang → 400.
  const p4 = (await mkPatient('BAD')).body;
  await clearMailhog();
  await req('POST', `/surveys/${csat.body.id}/invite`, { token: admin.token, body: { patientId: p4.id } });
  const token4 = await tokenFromMail();
  const bad = await pub('POST', token4, { score: 9 });
  check('CSAT điểm 9 (ngoài 1-5) → 400', bad.status === 400, `status=${bad.status}`);

  console.log('\n--- 7b. Khảo sát TUỲ CHỈNH: nhiều câu + thang điểm riêng ---');
  const custom = await req('POST', '/surveys', {
    token: admin.token,
    body: {
      name: `Tuỳ chỉnh ${run}`,
      type: 'custom',
      questions: [
        { id: 'q1', text: 'Mức độ hài lòng chung', type: 'scale', min: 1, max: 4, primary: true, required: true, negativeAtOrBelow: 2 },
        { id: 'q2', text: 'Bạn dùng dịch vụ nào?', type: 'choice', options: ['Khám tổng quát', 'Nha khoa', 'Xét nghiệm'], required: true },
        { id: 'q3', text: 'Góp ý', type: 'text' },
      ],
    },
  });
  check('tạo khảo sát tuỳ chỉnh (3 câu) → 201', custom.status === 201 && custom.body?.questions?.length === 3, JSON.stringify(custom.body?.questions?.length));
  await req('PATCH', `/surveys/${custom.body.id}`, { token: admin.token, body: { status: 'active' } });

  const pc = (await mkPatient('CUS')).body;
  await clearMailhog();
  await req('POST', `/surveys/${custom.body.id}/invite`, { token: admin.token, body: { patientId: pc.id, doctorId: doctor.user.id } });
  const tokenC = await tokenFromMail();
  const viewC = await pub('GET', tokenC);
  check('xem khảo sát tuỳ chỉnh trả đủ 3 câu + thang 1-4', viewC.body?.questions?.length === 3 && viewC.body?.questions?.[0]?.max === 4, JSON.stringify(viewC.body?.questions?.[0]));

  // Thiếu câu bắt buộc (choice) → 400.
  const miss = await pub('POST', tokenC, { answers: { q1: 2 } });
  check('thiếu câu bắt buộc → 400', miss.status === 400, `status=${miss.status}`);
  // Điểm ngoài thang tuỳ chỉnh (1-4) → 400.
  const oob = await pub('POST', tokenC, { answers: { q1: 5, q2: 'Nha khoa' } });
  check('điểm ngoài thang 1-4 → 400', oob.status === 400, `status=${oob.status}`);
  // Lựa chọn không hợp lệ → 400.
  const badChoice = await pub('POST', tokenC, { answers: { q1: 3, q2: 'Không có' } });
  check('lựa chọn không hợp lệ → 400', badChoice.status === 400, `status=${badChoice.status}`);
  // Hợp lệ: điểm 2 (≤ ngưỡng 2) → tiêu cực; góp ý mã hoá.
  const okC = await pub('POST', tokenC, { answers: { q1: 2, q2: 'Nha khoa', q3: 'Cần thêm chỗ đậu xe' } });
  check('trả lời hợp lệ (điểm 2) → tiêu cực theo ngưỡng tuỳ chỉnh', okC.status === 200 && okC.body?.isNegative === true, JSON.stringify(okC.body));
  const leakC = sql(`SELECT count(*) FROM survey_responses WHERE comment_enc::text LIKE '%đậu xe%' OR answers_enc::text LIKE '%Nha khoa%'`);
  check('answers/comment tuỳ chỉnh đã mã hoá', leakC === '0', `leak=${leakC}`);
  const custReport = await req('GET', `/surveys/${custom.body.id}/report`, { token: admin.token });
  check('báo cáo tuỳ chỉnh: điểm TB = 2, 1 tiêu cực', custReport.body?.overall?.avgScore === 2 && custReport.body?.negativeCount === 1, JSON.stringify(custReport.body?.overall));

  console.log('\n--- 8. Trend + RBAC + khảo sát đã đóng ---');
  const trend = await req('GET', `/surveys/${surveyId}/trend`, { token: admin.token });
  check('xu hướng theo tháng có dữ liệu', Array.isArray(trend.body?.trend) && trend.body.trend.length >= 1, JSON.stringify(trend.body?.trend));
  const docCreate = await req('POST', '/surveys', { token: doctor.token, body: { name: 'x', type: 'nps' } });
  check('bác sĩ tạo khảo sát → 403 (chỉ read)', docCreate.status === 403, `status=${docCreate.status}`);
  const audList = await req('GET', '/surveys', { token: auditor.token });
  check('kiểm toán đọc khảo sát → 403', audList.status === 403, `status=${audList.status}`);
  const badToken = await pub('GET', 'khong-ton-tai-token-123456');
  check('token sai → 404', badToken.status === 404, `status=${badToken.status}`);
  await req('PATCH', `/surveys/${surveyId}`, { token: admin.token, body: { status: 'closed' } });
  const closedView = await pub('GET', token1);
  check('khảo sát đã đóng → link 409', closedView.status === 409, `status=${closedView.status}`);

  console.log('\n--- 9. Audit + PHI ---');
  const audit = await req('GET', '/audit/logs?pageSize=200', { token: admin.token });
  const actions = (audit.body?.data ?? []).map((l) => l.action);
  check('audit có SURVEY_CREATE + INVITE_SEND + NEGATIVE_ALERT', ['SURVEY_CREATE', 'SURVEY_INVITE_SEND', 'SURVEY_NEGATIVE_ALERT'].every((a) => actions.includes(a)), actions.slice(0, 12).join(','));
  check('audit không lộ góp ý bệnh nhân', !JSON.stringify(audit.body).includes('Chờ hơi lâu'));
} catch (err) {
  fail++;
  console.error('LỖI:', err.stack || err.message);
} finally {
  await cleanup();
}

console.log(`\n${'='.repeat(48)}\n  KẾT QUẢ SURVEY: ${pass} pass, ${fail} fail\n${'='.repeat(48)}\n`);
process.exit(fail > 0 ? 1 : 0);
