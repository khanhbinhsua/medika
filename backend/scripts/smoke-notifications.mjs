import { authenticator } from 'otplib';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';

// Cổng riêng cho bản backend do chính smoke này khởi động (không đụng dev 4100).
const API_PORT = 4111;
const MOCK_PORT = 4199;
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

async function clearMailhog() {
  await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => {});
}
async function mailhogMessages() {
  const res = await fetch(`${MAILHOG}/messages`);
  return (await res.json()).items ?? [];
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

// ── Mock Zalo ZNS + eSMS (bắt chước shape phản hồi thật) ─────────────────
// Backend gọi VÀO đây bằng fetch — kiểm chứng đúng code provider thật, không
// giả lập ở tầng service. Cờ zaloOk/smsOk cho phép smoke ép từng kênh
// fail để kiểm tra chuỗi fallback zalo → sms → email.
const mock = { zaloOk: true, smsOk: true, zaloHits: 0, smsHits: 0, lastZaloBody: null };

function startMockServer() {
  return new Promise((resolve) => {
    const server = http.createServer((reqm, res) => {
      let raw = '';
      reqm.on('data', (c) => (raw += c));
      reqm.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        res.setHeader('Content-Type', 'application/json');
        if (reqm.url === '/zns') {
          mock.zaloHits++;
          mock.lastZaloBody = body;
          if (mock.zaloOk) res.end(JSON.stringify({ error: 0, message: 'Success', data: { msg_id: `zns-${Date.now()}` } }));
          else res.end(JSON.stringify({ error: -124, message: 'user not found' }));
        } else if (reqm.url === '/esms') {
          mock.smsHits++;
          if (mock.smsOk) res.end(JSON.stringify({ CodeResult: '100', SMSID: `sms-${Date.now()}` }));
          else res.end(JSON.stringify({ CodeResult: '104', ErrorMessage: 'Brandname invalid' }));
        } else {
          res.statusCode = 404;
          res.end('{}');
        }
      });
    });
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server));
  });
}

// ── Khởi động một backend riêng, trỏ Zalo/SMS vào mock ───────────────────
function startBackend() {
  const child = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: process.cwd(),
    shell: true,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      ZALO_PROVIDER: 'zns',
      ZALO_ACCESS_TOKEN: 'test-token',
      ZALO_ZNS_ENDPOINT: `http://127.0.0.1:${MOCK_PORT}/zns`,
      SMS_PROVIDER: 'esms',
      ESMS_API_KEY: 'test-key',
      ESMS_SECRET_KEY: 'test-secret',
      ESMS_ENDPOINT: `http://127.0.0.1:${MOCK_PORT}/esms`,
      NOTIFY_CHANNEL_ORDER: 'zalo,sms,email',
      NOTIFY_WEBHOOK_SECRET: 'smoke-webhook-secret',
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.env.SMOKE_VERBOSE && process.stdout.write(`[api] ${d}`));
  child.stderr.on('data', (d) => process.stdout.write(`[api:err] ${d}`));
  return child;
}

async function waitHealthy(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${API_PORT}/api/health`);
      if (res.ok) return true;
    } catch {
      /* chưa lên */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let backend, mockServer;
async function cleanup() {
  if (backend) backend.kill('SIGTERM');
  if (mockServer) mockServer.close();
}

try {
  console.log('\n--- Chuẩn bị: mock Zalo/eSMS + backend riêng ---');
  mockServer = await startMockServer();
  backend = startBackend();
  const healthy = await waitHealthy();
  check('backend (cổng riêng, Zalo/SMS→mock) khởi động', healthy);
  if (!healthy) throw new Error('backend không lên');

  await clearMailhog();
  const admin = await loginAs('admin@crm-dk.local');
  const reception = await loginAs('letan@crm-dk.local');
  const doctor = await loginAs('bacsi@crm-dk.local');
  check('đăng nhập admin/lễ tân/bác sĩ', !!(admin.token && reception.token && doctor.token));

  const run = Date.now().toString().slice(-8);
  const email = `notify.${run}@example.com`;
  const patient = await req('POST', '/patients', {
    token: admin.token,
    body: { firstName: 'Thông Báo', lastName: 'Thử', dob: '1991-04-04', email, phone: `09${run}` },
  });
  check('tạo bệnh nhân (có email + sđt)', patient.status === 201, JSON.stringify(patient.body));
  const pid = patient.body?.id;

  // Bệnh nhân chỉ có email (không sđt) — để kiểm tra bỏ qua kênh thiếu liên hệ.
  const emailOnly = `emailonly.${run}@example.com`;
  const patient2 = await req('POST', '/patients', {
    token: admin.token,
    body: { firstName: 'Chỉ', lastName: 'Email', dob: '1992-05-05', email: emailOnly },
  });
  const pid2 = patient2.body?.id;

  console.log('\n--- 1. Kênh Zalo thành công (đầu chuỗi) ---');
  mock.zaloOk = true;
  mock.smsOk = true;
  const beforeZaloHits = mock.zaloHits;
  const s1 = await req('POST', '/notifications/send', {
    token: reception.token,
    body: { patientId: pid, kind: 'appointment_reminder', vars: { thoi_gian: '09:00 20/09/2026', phong: ' tại P.105' } },
  });
  check('gửi → 200', s1.status === 200, JSON.stringify(s1.body));
  check('kênh gửi = zalo (không cần fallback)', s1.body?.channelSent === 'zalo', JSON.stringify(s1.body));
  check('status = sent', s1.body?.status === 'sent');
  check('đã gọi Zalo ZNS mock đúng 1 lần', mock.zaloHits === beforeZaloHits + 1, `hits=${mock.zaloHits - beforeZaloHits}`);
  check('ZNS nhận template_id + phone (không văn bản thô)', !!mock.lastZaloBody?.template_id && !!mock.lastZaloBody?.phone, JSON.stringify(mock.lastZaloBody));
  // provider_message_id lưu lại để map read-receipt.
  const pmid1 = sql(`SELECT provider_message_id FROM notifications WHERE id='${s1.body.id}'`);
  check('lưu provider_message_id từ Zalo', pmid1.startsWith('zns-'), pmid1);

  console.log('\n--- 2. Zalo fail → fallback SMS Brandname ---');
  mock.zaloOk = false;
  mock.smsOk = true;
  const zh = mock.zaloHits, sh = mock.smsHits;
  const s2 = await req('POST', '/notifications/send', {
    token: reception.token,
    body: { patientId: pid, kind: 'appointment_reminder', vars: { thoi_gian: '10:00 21/09/2026', phong: '' } },
  });
  check('kênh gửi = sms (Zalo lỗi)', s2.body?.channelSent === 'sms', JSON.stringify(s2.body));
  check('đã thử Zalo rồi mới sang SMS', mock.zaloHits === zh + 1 && mock.smsHits === sh + 1);
  // notification_logs ghi lại attempt/failed/sent theo đúng thứ tự.
  const logs2 = sql(`SELECT channel||':'||event FROM notification_logs WHERE notification_id='${s2.body.id}' ORDER BY at`);
  check('log có zalo:failed rồi sms:sent', /zalo:failed/.test(logs2) && /sms:sent/.test(logs2), logs2.replace(/\n/g, ' '));

  console.log('\n--- 3. Zalo + SMS fail → fallback Email (Mailhog) ---');
  await clearMailhog();
  mock.zaloOk = false;
  mock.smsOk = false;
  const s3 = await req('POST', '/notifications/send', {
    token: reception.token,
    body: { patientId: pid, kind: 'appointment_reminder', vars: { thoi_gian: '11:00 22/09/2026', phong: ' tại P.202' } },
  });
  check('kênh gửi = email (Zalo+SMS lỗi)', s3.body?.channelSent === 'email', JSON.stringify(s3.body));
  await new Promise((r) => setTimeout(r, 500));
  const mails = await mailhogMessages();
  check('Mailhog nhận đúng 1 email', mails.length === 1, `got ${mails.length}`);
  const toAddr = mails[0]?.Content?.Headers?.To?.[0] ?? '';
  check('email đúng địa chỉ bệnh nhân', toAddr.includes(email), toAddr);

  console.log('\n--- 4. Tất cả kênh fail → status failed ---');
  mock.zaloOk = false;
  mock.smsOk = false;
  // Chặn email: tắt SMTP bằng cách gửi cho bệnh nhân... vẫn có email nên email sẽ
  // thành công. Thay vào đó kiểm tra: bệnh nhân KHÔNG có kênh nào khả dụng vì
  // template email bị tắt. Tắt template email tạm thời.
  sql(`UPDATE notification_templates SET active=false WHERE channel='email' AND kind='appointment_reminder'`);
  const s4 = await req('POST', '/notifications/send', {
    token: reception.token,
    body: { patientId: pid, kind: 'appointment_reminder', vars: { thoi_gian: 'x', phong: '' } },
  });
  check('mọi kênh hỏng/không có template → 502 + failed', s4.status === 502 && s4.body?.status === 'failed', JSON.stringify(s4.body));
  sql(`UPDATE notification_templates SET active=true WHERE channel='email' AND kind='appointment_reminder'`);

  console.log('\n--- 5. Bỏ qua kênh thiếu liên hệ (BN chỉ có email) ---');
  await clearMailhog();
  mock.zaloOk = true; // Zalo "ok" nhưng BN không có sđt → phải bỏ qua, không gọi ZNS
  mock.smsOk = true;
  const zh5 = mock.zaloHits, sh5 = mock.smsHits;
  const s5 = await req('POST', '/notifications/send', {
    token: reception.token,
    body: { patientId: pid2, kind: 'appointment_reminder', vars: { thoi_gian: '08:00 23/09/2026', phong: '' } },
  });
  check('BN chỉ-email → gửi qua email', s5.body?.channelSent === 'email', JSON.stringify(s5.body));
  check('KHÔNG gọi Zalo/SMS vì thiếu sđt', mock.zaloHits === zh5 && mock.smsHits === sh5, `zalo+${mock.zaloHits - zh5} sms+${mock.smsHits - sh5}`);
  const logs5 = sql(`SELECT channel||':'||event FROM notification_logs WHERE notification_id='${s5.body.id}' ORDER BY at`);
  check('log ghi zalo:skip + sms:skip (no_contact)', /zalo:skip/.test(logs5) && /sms:skip/.test(logs5), logs5.replace(/\n/g, ' '));

  console.log('\n--- 6. Webhook đánh dấu đã đọc (read receipt) ---');
  // Gửi 1 tin qua Zalo để có provider_message_id, rồi webhook báo đã đọc.
  mock.zaloOk = true;
  const s6 = await req('POST', '/notifications/send', {
    token: reception.token,
    body: { patientId: pid, kind: 'appointment_reminder', vars: { thoi_gian: '07:00 24/09/2026', phong: '' } },
  });
  const pmid6 = sql(`SELECT provider_message_id FROM notifications WHERE id='${s6.body.id}'`);
  const whNoSecret = await fetch(`${BASE}/notifications/webhook/zalo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message_id: pmid6 }),
  });
  check('webhook thiếu secret → 401', whNoSecret.status === 401, `status=${whNoSecret.status}`);
  const wh = await fetch(`${BASE}/notifications/webhook/zalo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer smoke-webhook-secret' },
    body: JSON.stringify({ message_id: pmid6 }),
  });
  const whJson = await wh.json();
  check('webhook đúng secret → cập nhật read', wh.status === 200 && whJson.updated === true, JSON.stringify(whJson));
  const st6 = sql(`SELECT status FROM notifications WHERE id='${s6.body.id}'`);
  check('notification chuyển sang read', st6 === 'read', st6);

  console.log('\n--- 7. Quản lý template (CRUD) ---');
  const tpls = await req('GET', '/notifications/templates', { token: admin.token });
  check('liệt kê template', Array.isArray(tpls.body) && tpls.body.length >= 3, `n=${tpls.body?.length}`);
  const smsTpl = tpls.body.find((t) => t.channel === 'sms' && t.kind === 'appointment_reminder');
  const upd = await req('PATCH', `/notifications/templates/${smsTpl.id}`, {
    token: admin.token,
    body: { content: '{{ten}} nhac lich {{thoi_gian}} - test update' },
  });
  check('cập nhật template → 200', upd.status === 200 && upd.body.content.includes('test update'), JSON.stringify(upd.body));

  console.log('\n--- 8. RBAC + PHI ---');
  const bacsiSend = await req('POST', '/notifications/send', {
    token: doctor.token,
    body: { patientId: pid, kind: 'appointment_reminder' },
  });
  check('bác sĩ KHÔNG có notification:manage → 403', bacsiSend.status === 403, `status=${bacsiSend.status}`);

  // notifications + logs KHÔNG được chứa PHI (tên BN, nội dung render).
  const rawNotif = sql(`SELECT COALESCE(string_agg(coalesce(last_error,'')||coalesce(channel_sent::text,''),' '),'') FROM notifications WHERE patient_id='${pid}'`);
  check('bảng notifications không chứa tên bệnh nhân', !rawNotif.includes('Thông Báo'), rawNotif.slice(0, 60));
  const rawLogs = sql(`SELECT COALESCE(string_agg(coalesce(detail,''),' '),'') FROM notification_logs`);
  check('notification_logs không chứa tên bệnh nhân', !rawLogs.includes('Thông Báo'));

  // Audit ghi hành động gửi.
  const audit = await req('GET', '/audit/logs?pageSize=200', { token: admin.token });
  const actions = (audit.body?.data ?? []).map((l) => l.action);
  check('audit có NOTIFICATION_SEND_MANUAL', actions.includes('NOTIFICATION_SEND_MANUAL'));
  check('audit có NOTIFICATION_TEMPLATE_UPDATE', actions.includes('NOTIFICATION_TEMPLATE_UPDATE'));
} catch (err) {
  fail++;
  console.error('LỖI:', err.message);
} finally {
  await cleanup();
}

console.log(`\n${'='.repeat(48)}\n  KẾT QUẢ NOTIFICATIONS: ${pass} pass, ${fail} fail\n${'='.repeat(48)}\n`);
process.exit(fail > 0 ? 1 : 0);
