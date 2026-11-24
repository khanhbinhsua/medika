import { authenticator } from 'otplib';
import { execFileSync, spawn } from 'node:child_process';

const API_PORT = 4113;
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

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', 'crm-dk-postgres', 'psql', '-U', 'crm_app', '-d', 'crm_dk', '-t', '-A', '-c', query],
    { encoding: 'utf8' },
  ).trim();
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

async function grantMarketing(token, patientId) {
  return req('POST', '/consents', {
    token,
    body: { patientId, consentType: 'marketing', granted: true, documentVersion: 'v1' },
  });
}

try {
  console.log('\n--- Chuẩn bị: backend riêng (cổng 4113) ---');
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
  const today = new Date();
  const bdayDob = `1990-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // pA: consent + sinh nhật hôm nay. pB: KHÔNG consent + sinh nhật hôm nay. pC: consent, dob thường.
  const mk = (fn, dob) =>
    req('POST', '/patients', { token: admin.token, body: { firstName: fn, lastName: 'CSKH', dob, gender: 'other', phone: `09${run}${fn.length}` } });
  const pA = (await mk('AA', bdayDob)).body;
  const pB = (await mk('BB', bdayDob)).body;
  const pC = (await mk('CC', '1985-01-15')).body;
  check('tạo 3 bệnh nhân test', !!(pA?.id && pB?.id && pC?.id));
  const g1 = await grantMarketing(admin.token, pA.id);
  const g2 = await grantMarketing(admin.token, pC.id);
  check('cấp consent marketing cho pA, pC', g1.status === 201 && g2.status === 201);

  console.log('\n--- 1. Nhóm khách hàng (segment) ---');
  const seg = await req('POST', '/marketing/segments', {
    token: admin.token,
    body: { name: `Nhóm other ${run}`, criteria: { gender: 'other', newWithinDays: 1 } },
  });
  check('tạo segment → 201', seg.status === 201, JSON.stringify(seg.body));
  const segId = seg.body?.id;
  const preview = await req('GET', `/marketing/segments/${segId}/preview`, { token: reception.token });
  check('preview đếm được thành viên (>=3)', preview.body?.count >= 3, `count=${preview.body?.count}`);
  const adhoc = await req('POST', '/marketing/segments/preview', {
    token: reception.token,
    body: { criteria: { gender: 'other', minVisits: 999 } },
  });
  check('preview criteria tuỳ ý (minVisits cao → 0)', adhoc.body?.count === 0, `count=${adhoc.body?.count}`);

  console.log('\n--- 2. Chiến dịch + BẮT BUỘC consent marketing ---');
  const camp = await req('POST', '/marketing/campaigns', {
    token: admin.token,
    body: { name: `KM ${run}`, segmentId: segId, message: 'Ưu đãi tháng này giảm 20% dịch vụ.' },
  });
  check('tạo chiến dịch → 201', camp.status === 201, JSON.stringify(camp.body));
  const campId = camp.body?.id;
  const send = await req('POST', `/marketing/campaigns/${campId}/send`, { token: admin.token });
  check('gửi chiến dịch → 200', send.status === 200, JSON.stringify(send.body));
  check('có loại người chưa đồng ý marketing (skippedNoConsent>=1)', send.body?.skippedNoConsent >= 1, JSON.stringify(send.body));

  // Kiểm tra theo ID: pA/pC (có consent) là recipient; pB (không consent) KHÔNG.
  const inA = sql(`SELECT count(*) FROM campaign_recipients WHERE campaign_id='${campId}' AND patient_id='${pA.id}'`);
  const inC = sql(`SELECT count(*) FROM campaign_recipients WHERE campaign_id='${campId}' AND patient_id='${pC.id}'`);
  const inB = sql(`SELECT count(*) FROM campaign_recipients WHERE campaign_id='${campId}' AND patient_id='${pB.id}'`);
  check('pA (có consent) là người nhận', inA === '1', `inA=${inA}`);
  check('pC (có consent) là người nhận', inC === '1', `inC=${inC}`);
  check('pB (KHÔNG consent) bị loại khỏi người nhận', inB === '0', `inB=${inB}`);

  const report = await req('GET', `/marketing/campaigns/${campId}/report`, { token: reception.token });
  check('báo cáo chiến dịch có tỷ lệ gửi', report.body?.total >= 2 && typeof report.body?.deliveryRate === 'number', JSON.stringify(report.body));
  const resend = await req('POST', `/marketing/campaigns/${campId}/send`, { token: admin.token });
  check('gửi lại chiến dịch đã gửi → 409', resend.status === 409, `status=${resend.status}`);

  // Hồi phục chiến dịch kẹt 'sending' (mô phỏng tiến trình chết giữa chừng):
  // ép status='sending', gửi lại phải chạy được và KHÔNG tạo người nhận trùng.
  const recipBefore = sql(`SELECT count(*) FROM campaign_recipients WHERE campaign_id='${campId}'`);
  sql(`UPDATE campaigns SET status='sending' WHERE id='${campId}'`);
  const recover = await req('POST', `/marketing/campaigns/${campId}/send`, { token: admin.token });
  check('chiến dịch kẹt "sending" gửi lại được → 200', recover.status === 200, `status=${recover.status}`);
  const recipAfter = sql(`SELECT count(*) FROM campaign_recipients WHERE campaign_id='${campId}'`);
  check('gửi lại không tạo người nhận trùng (bỏ qua đã sent)', recipBefore === recipAfter, `before=${recipBefore} after=${recipAfter}`);
  const statusAfter = sql(`SELECT status FROM campaigns WHERE id='${campId}'`);
  check('sau hồi phục status về "sent"', statusAfter === 'sent', statusAfter);

  console.log('\n--- 3. Chăm sóc hậu điều trị TỰ ĐỘNG khi hoàn thành phác đồ ---');
  const plan = await req('POST', '/treatment-plans', {
    token: doctor.token,
    body: { patientId: pC.id, doctorId: doctor.user.id, title: 'Liệu trình CSKH', steps: [{ title: 'Buổi 1', cost: 100000 }] },
  });
  await req('POST', `/treatment-plans/${plan.body.id}/submit`, { token: doctor.token });
  await req('POST', `/treatment-plans/${plan.body.id}/approve`, { token: admin.token });
  const stepId = plan.body.steps[0].id;
  const complete = await req('PATCH', `/treatment-plans/${plan.body.id}/steps/${stepId}`, {
    token: doctor.token,
    body: { status: 'completed' },
  });
  check('phác đồ tự hoàn thành', complete.body?.status === 'completed');
  const careRow = sql(`SELECT count(*) FROM post_treatment_care WHERE patient_id='${pC.id}' AND treatment_plan_id='${plan.body.id}' AND care_type='follow_up'`);
  check('TỰ tạo chăm sóc hậu điều trị khi phác đồ xong', careRow === '1', `rows=${careRow}`);

  console.log('\n--- 4. Điều phối chăm sóc hậu điều trị ---');
  // Đẩy scheduled_at về quá khứ để tới hạn ngay.
  sql(`UPDATE post_treatment_care SET scheduled_at = now() - interval '1 minute' WHERE patient_id='${pC.id}' AND status='pending'`);
  const dispCare = await req('POST', '/marketing/care/dispatch', { token: admin.token });
  check('điều phối chăm sóc → gửi >=1', dispCare.body?.sent >= 1, JSON.stringify(dispCare.body));
  const careSent = sql(`SELECT status FROM post_treatment_care WHERE patient_id='${pC.id}' ORDER BY created_at DESC LIMIT 1`);
  check('chăm sóc chuyển sang sent', careSent === 'sent', careSent);
  const careList = await req('GET', `/marketing/care/patient/${pC.id}`, { token: reception.token });
  check('liệt kê chăm sóc theo bệnh nhân', Array.isArray(careList.body) && careList.body.length >= 1);

  console.log('\n--- 5. Chúc mừng sinh nhật (consent + idempotent) ---');
  const bday1 = await req('POST', '/marketing/birthday/dispatch', {
    token: admin.token,
    body: { message: 'Chúc mừng sinh nhật! Tặng bạn voucher 100k.' },
  });
  check('điều phối sinh nhật chạy được', bday1.status === 200, JSON.stringify(bday1.body));
  const bdayA = sql(`SELECT count(*) FROM notifications WHERE patient_id='${pA.id}' AND related_type='birthday'`);
  const bdayB = sql(`SELECT count(*) FROM notifications WHERE patient_id='${pB.id}' AND related_type='birthday'`);
  check('pA (sinh nhật + consent) nhận lời chúc', bdayA === '1', `bdayA=${bdayA}`);
  check('pB (sinh nhật, KHÔNG consent) KHÔNG nhận', bdayB === '0', `bdayB=${bdayB}`);
  // Idempotent trong năm: chạy lại không gửi trùng.
  await req('POST', '/marketing/birthday/dispatch', { token: admin.token, body: { message: 'x' } });
  const bdayA2 = sql(`SELECT count(*) FROM notifications WHERE patient_id='${pA.id}' AND related_type='birthday'`);
  check('chạy lại → không gửi sinh nhật trùng (vẫn 1)', bdayA2 === '1', `bdayA2=${bdayA2}`);

  console.log('\n--- 6. Báo cáo tỷ lệ quay lại ---');
  const ret = await req('GET', '/marketing/reports/retention', { token: reception.token });
  check('báo cáo retention có số liệu', typeof ret.body?.totalPatients === 'number' && typeof ret.body?.retentionRate === 'number', JSON.stringify(ret.body));

  console.log('\n--- 7. RBAC + PHI ---');
  const docSeg = await req('POST', '/marketing/segments', { token: doctor.token, body: { name: 'x', criteria: {} } });
  check('bác sĩ (không quyền marketing) tạo segment → 403', docSeg.status === 403, `status=${docSeg.status}`);
  const audList = await req('GET', '/marketing/segments', { token: auditor.token });
  check('kiểm toán đọc segment → 403', audList.status === 403, `status=${audList.status}`);

  // campaigns/segments KHÔNG chứa PHI (nội dung marketing chung; không tên bệnh nhân).
  const rawCamp = sql(`SELECT COALESCE(string_agg(message,' '),'') FROM campaigns`);
  check('bảng campaigns không chứa tên bệnh nhân', !/AA CSKH|BB CSKH|CC CSKH/.test(rawCamp));

  const audit = await req('GET', '/audit/logs?pageSize=200', { token: admin.token });
  const actions = (audit.body?.data ?? []).map((l) => l.action);
  check('audit có CAMPAIGN_SEND + BIRTHDAY_DISPATCH', actions.includes('CAMPAIGN_SEND') && actions.includes('BIRTHDAY_DISPATCH'), actions.slice(0, 10).join(','));
} catch (err) {
  fail++;
  console.error('LỖI:', err.stack || err.message);
} finally {
  await cleanup();
}

console.log(`\n${'='.repeat(48)}\n  KẾT QUẢ MARKETING & CSKH: ${pass} pass, ${fail} fail\n${'='.repeat(48)}\n`);
process.exit(fail > 0 ? 1 : 0);
