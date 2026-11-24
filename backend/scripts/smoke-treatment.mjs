import { authenticator } from 'otplib';
import { execFileSync, spawn } from 'node:child_process';

const API_PORT = 4112;
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
  // tsx spawn một tiến trình con — kill mỗi tiến trình cha để lại server mồ côi
  // giữ cổng. Trên Windows dùng taskkill /T để hạ cả cây tiến trình.
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(backend.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* đã tắt */
    }
  } else {
    backend.kill('SIGTERM');
  }
}

try {
  console.log('\n--- Chuẩn bị: backend riêng (cổng 4112) ---');
  backend = startBackend();
  const healthy = await waitHealthy();
  check('backend khởi động', healthy);
  if (!healthy) throw new Error('backend không lên');

  const admin = await loginAs('admin@crm-dk.local');
  const doctor = await loginAs('bacsi@crm-dk.local');
  const nurse = await loginAs('yta@crm-dk.local');
  const reception = await loginAs('letan@crm-dk.local');
  const auditor = await loginAs('kiemtoan@crm-dk.local');
  check('đăng nhập 5 vai trò', !!(admin.token && doctor.token && nurse.token && reception.token && auditor.token));

  const run = Date.now().toString().slice(-8);
  const patient = await req('POST', '/patients', {
    token: admin.token,
    body: { firstName: 'Phác Đồ', lastName: 'Nguyễn', dob: '1988-02-02', phone: `09${run}` },
  });
  check('tạo bệnh nhân', patient.status === 201, JSON.stringify(patient.body));
  const pid = patient.body?.id;

  console.log('\n--- 1. Template mẫu ---');
  const tpls = await req('GET', '/treatment-plans/templates', { token: doctor.token });
  const endo = tpls.body?.find((t) => t.code === 'endo_molar');
  check('có template seed endo_molar (3 bước)', endo?.steps?.length === 3, JSON.stringify(tpls.body?.map((t) => t.code)));
  check('template có chi phí ước tính', endo?.steps?.[2]?.estimatedCost === 3000000, JSON.stringify(endo?.steps));
  const newTpl = await req('POST', '/treatment-plans/templates', {
    token: admin.token,
    body: {
      code: `tmpl_${run}`,
      name: 'Tẩy trắng răng',
      condition: 'Thẩm mỹ',
      steps: [
        { title: 'Khám & lấy cao răng', estimatedCost: 300000 },
        { title: 'Tẩy trắng tại phòng', estimatedCost: 1500000 },
      ],
    },
  });
  check('tạo template mới → 201', newTpl.status === 201 && newTpl.body?.steps?.length === 2, `status=${newTpl.status} ${JSON.stringify(newTpl.body)}`);

  console.log('\n--- 2. Tạo phác đồ từ template ---');
  const created = await req('POST', '/treatment-plans/from-template', {
    token: doctor.token,
    body: { patientId: pid, doctorId: doctor.user.id, templateId: endo.id },
  });
  check('tạo từ template → 201', created.status === 201, JSON.stringify(created.body));
  const plan = created.body;
  check('phác đồ ở trạng thái draft', plan?.status === 'draft');
  check('sao chép đủ 3 bước', plan?.steps?.length === 3);
  check('total_cost = tổng bước (4.7tr)', plan?.totalCost === 4700000, `got ${plan?.totalCost}`);
  check('tiêu đề giải mã = tên template', plan?.title === 'Điều trị tuỷ răng hàm', plan?.title);
  const planId = plan.id;

  console.log('\n--- 3. PHI mã hoá tại chỗ ---');
  const leak = sql(`SELECT count(*) FROM treatment_plans WHERE title_enc::text LIKE '%tuỷ%' OR title_enc::text LIKE '%tuy%'`);
  check('title_enc KHÔNG chứa tiêu đề dạng chữ (đã mã hoá)', leak === '0', `leak=${leak}`);
  const stepLeak = sql(`SELECT count(*) FROM treatment_steps WHERE title_enc::text LIKE '%tuỷ%' OR title_enc::text LIKE '%X-quang%'`);
  check('step.title_enc đã mã hoá', stepLeak === '0', `leak=${stepLeak}`);

  console.log('\n--- 4. Thêm bước + tính lại tổng ---');
  const added = await req('POST', `/treatment-plans/${planId}/steps`, {
    token: doctor.token,
    body: { title: 'Tái khám sau 1 tuần', cost: 200000 },
  });
  check('thêm bước → 201, 4 bước', added.status === 201 && added.body.steps.length === 4, JSON.stringify(added.body?.steps?.length));
  check('total_cost = 4.9tr sau khi thêm', added.body?.totalCost === 4900000, `got ${added.body?.totalCost}`);
  const step1 = added.body.steps[0];
  const step4 = added.body.steps[3];

  console.log('\n--- 5. Cập nhật bước + tiến độ ---');
  const done1 = await req('PATCH', `/treatment-plans/${planId}/steps/${step1.id}`, {
    token: nurse.token,
    body: { status: 'completed' },
  });
  check('y tá cập nhật bước → 200', done1.status === 200);
  check('bước 1 có mốc hoàn thành', !!done1.body.steps.find((s) => s.id === step1.id)?.completedAt);
  check('tiến độ = 1/4 (25%)', done1.body.progress.completed === 1 && done1.body.progress.percent === 25, JSON.stringify(done1.body.progress));

  // Huỷ 1 bước → loại khỏi tổng và khỏi mẫu số tiến độ.
  const cancelStep = await req('PATCH', `/treatment-plans/${planId}/steps/${step4.id}`, {
    token: doctor.token,
    body: { status: 'cancelled' },
  });
  check('huỷ bước → total giảm còn 4.7tr', cancelStep.body?.totalCost === 4700000, `got ${cancelStep.body?.totalCost}`);
  check('tiến độ mẫu số bỏ bước huỷ (1/3=33%)', cancelStep.body.progress.total === 3 && cancelStep.body.progress.percent === 33, JSON.stringify(cancelStep.body.progress));

  console.log('\n--- 6. Gửi duyệt + phê duyệt (tách vai trò) ---');
  const approveEarly = await req('POST', `/treatment-plans/${planId}/approve`, { token: admin.token });
  check('duyệt khi chưa gửi duyệt → 409', approveEarly.status === 409, `status=${approveEarly.status}`);
  const submit = await req('POST', `/treatment-plans/${planId}/submit`, { token: doctor.token });
  check('gửi duyệt → pending_approval', submit.body?.status === 'pending_approval', JSON.stringify(submit.body?.status));
  const selfApprove = await req('POST', `/treatment-plans/${planId}/approve`, { token: doctor.token });
  check('bác sĩ phụ trách tự duyệt → 400 (tách vai trò)', selfApprove.status === 400, `status=${selfApprove.status}`);
  const recApprove = await req('POST', `/treatment-plans/${planId}/approve`, { token: reception.token });
  check('lễ tân duyệt → 403 (thiếu quyền)', recApprove.status === 403, `status=${recApprove.status}`);
  const approve = await req('POST', `/treatment-plans/${planId}/approve`, { token: admin.token });
  check('admin (khác bác sĩ) duyệt → active', approve.body?.status === 'active', JSON.stringify(approve.body?.status));
  check('ghi người duyệt', approve.body?.approvedBy === admin.user.id && !!approve.body?.approvedAt);

  console.log('\n--- 7. Tự hoàn thành khi mọi bước chốt ---');
  const remaining = approve.body.steps.filter((s) => s.status === 'pending' || s.status === 'scheduled');
  let last;
  for (const s of remaining) {
    last = await req('PATCH', `/treatment-plans/${planId}/steps/${s.id}`, {
      token: doctor.token,
      body: { status: 'completed' },
    });
  }
  check('hoàn tất mọi bước → phác đồ tự completed', last?.body?.status === 'completed', JSON.stringify(last?.body?.status));
  const editDone = await req('POST', `/treatment-plans/${planId}/steps`, { token: doctor.token, body: { title: 'x' } });
  check('phác đồ đã chốt → không thêm bước (409)', editDone.status === 409, `status=${editDone.status}`);

  console.log('\n--- 8. Huỷ phác đồ + lý do mã hoá ---');
  const p2 = await req('POST', '/treatment-plans', {
    token: doctor.token,
    body: { patientId: pid, doctorId: doctor.user.id, title: 'Phác đồ thử huỷ', steps: [{ title: 'Bước A', cost: 100000 }] },
  });
  const cancel = await req('POST', `/treatment-plans/${p2.body.id}/cancel`, {
    token: doctor.token,
    body: { reason: 'Bệnh nhân đổi kế hoạch điều trị' },
  });
  check('huỷ phác đồ → cancelled', cancel.body?.status === 'cancelled', JSON.stringify(cancel.body?.status));
  check('lý do huỷ giải mã đúng', cancel.body?.cancelReason === 'Bệnh nhân đổi kế hoạch điều trị', cancel.body?.cancelReason);
  const cancelLeak = sql(`SELECT count(*) FROM treatment_plans WHERE cancel_reason_enc::text LIKE '%đổi kế hoạch%'`);
  check('cancel_reason_enc đã mã hoá', cancelLeak === '0', `leak=${cancelLeak}`);
  const cancelAgain = await req('POST', `/treatment-plans/${p2.body.id}/cancel`, { token: doctor.token, body: { reason: 'x' } });
  check('huỷ lại phác đồ đã chốt → 409', cancelAgain.status === 409, `status=${cancelAgain.status}`);

  console.log('\n--- 9. Liên kết bước với lịch hẹn ---');
  const t0 = new Date(Date.now() + (200 + Math.floor(Math.random() * 3000)) * 86400_000);
  t0.setSeconds(0, 0);
  const appt = await req('POST', '/appointments', {
    token: reception.token,
    body: { patientId: pid, doctorId: doctor.user.id, scheduledStart: t0.toISOString(), scheduledEnd: new Date(t0.getTime() + 1800_000).toISOString() },
  });
  const p3 = await req('POST', '/treatment-plans', {
    token: doctor.token,
    body: { patientId: pid, doctorId: doctor.user.id, title: 'Phác đồ có lịch', steps: [{ title: 'Buổi điều trị 1' }] },
  });
  const linkStep = p3.body.steps[0];
  const link = await req('PATCH', `/treatment-plans/${p3.body.id}/steps/${linkStep.id}`, {
    token: doctor.token,
    body: { status: 'scheduled', appointmentId: appt.body.id, scheduledDate: t0.toISOString() },
  });
  check('gắn bước với lịch hẹn → 200', link.status === 200 && link.body.steps[0].appointmentId === appt.body.id, JSON.stringify(link.body?.steps?.[0]));

  // Lịch hẹn của bệnh nhân KHÁC → bị từ chối.
  const other = await req('POST', '/patients', { token: admin.token, body: { firstName: 'Khác', lastName: 'BN', dob: '1990-01-01' } });
  const t1 = new Date(Date.now() + (200 + Math.floor(Math.random() * 3000)) * 86400_000);
  t1.setSeconds(0, 0);
  const apptOther = await req('POST', '/appointments', {
    token: reception.token,
    body: { patientId: other.body.id, doctorId: doctor.user.id, scheduledStart: t1.toISOString(), scheduledEnd: new Date(t1.getTime() + 1800_000).toISOString() },
  });
  const badLink = await req('PATCH', `/treatment-plans/${p3.body.id}/steps/${linkStep.id}`, {
    token: doctor.token,
    body: { appointmentId: apptOther.body.id },
  });
  check('gắn lịch hẹn của BN khác → 400', badLink.status === 400, `status=${badLink.status}`);

  console.log('\n--- 10. Lịch sử thay đổi ---');
  const hist = await req('GET', `/treatment-plans/${planId}/history`, { token: doctor.token });
  const acts = (hist.body ?? []).map((h) => h.action);
  check('lịch sử có CREATE/SUBMIT/APPROVE', acts.includes('TREATMENT_PLAN_CREATE') && acts.includes('TREATMENT_PLAN_SUBMIT') && acts.includes('TREATMENT_PLAN_APPROVE'), acts.join(','));

  console.log('\n--- 11. RBAC + PHI ---');
  const recCreate = await req('POST', '/treatment-plans', {
    token: reception.token,
    body: { patientId: pid, doctorId: doctor.user.id, title: 'x' },
  });
  check('lễ tân tạo phác đồ → 403', recCreate.status === 403, `status=${recCreate.status}`);
  const audRead = await req('GET', `/treatment-plans/${planId}`, { token: auditor.token });
  check('kiểm toán (không quyền treatment) đọc → 403', audRead.status === 403, `status=${audRead.status}`);

  const listPlans = await req('GET', `/treatment-plans?patientId=${pid}`, { token: doctor.token });
  check('liệt kê phác đồ theo bệnh nhân', Array.isArray(listPlans.body) && listPlans.body.length >= 3, `n=${listPlans.body?.length}`);

  // PHI không lọt vào audit log.
  const audit = await req('GET', '/audit/logs?pageSize=200', { token: admin.token });
  const rawAudit = JSON.stringify(audit.body);
  check('audit không lộ tiêu đề lâm sàng', !rawAudit.includes('Điều trị tuỷ răng hàm'));
  const auditActions = (audit.body?.data ?? []).map((l) => l.action);
  check('audit có TREATMENT_PLAN_APPROVE', auditActions.includes('TREATMENT_PLAN_APPROVE'));

  // PHI access log ghi nhận truy cập phác đồ.
  const phiCount = sql(`SELECT count(*) FROM phi_access_logs WHERE 'treatment_plan' = ANY(fields_accessed) AND patient_id='${pid}'`);
  check('có ghi phi_access_log cho phác đồ', Number(phiCount) > 0, `count=${phiCount}`);
} catch (err) {
  fail++;
  console.error('LỖI:', err.stack || err.message);
} finally {
  await cleanup();
}

console.log(`\n${'='.repeat(48)}\n  KẾT QUẢ TREATMENT PLANS: ${pass} pass, ${fail} fail\n${'='.repeat(48)}\n`);
process.exit(fail > 0 ? 1 : 0);
