import { authenticator } from 'otplib';
import { execFileSync, spawn } from 'node:child_process';

const API_PORT = 4124;
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
  if (!first.body?.mfaEnrollmentRequired) throw new Error(`${email}: cần reset MFA trước`);
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

try {
  console.log('\n--- Chuẩn bị: backend riêng (cổng 4124) ---');
  backend = startBackend();
  const healthy = await waitHealthy();
  check('backend khởi động', healthy);
  if (!healthy) throw new Error('backend không lên');

  const admin = await loginAs('admin@crm-dk.local');
  const doctor = await loginAs('bacsi@crm-dk.local'); // condition:write + prescription:write
  const reception = await loginAs('letan@crm-dk.local'); // condition:read (không write)
  check('đăng nhập 3 vai trò', !!(admin.token && doctor.token && reception.token));
  check('bác sĩ có condition:write', doctor.user?.permissions?.includes('condition:write'));
  check('lễ tân KHÔNG có condition:write', !reception.user?.permissions?.includes('condition:write'));

  const run = Date.now().toString().slice(-8);
  const p = (
    await req('POST', '/patients', {
      token: admin.token,
      body: { firstName: 'Benh', lastName: 'Ly', dob: '1988-03-03', gender: 'other', phone: `09${run}1` },
    })
  ).body;
  check('tạo bệnh nhân', !!p?.id);

  console.log('\n--- 1. Endpoint lâm sàng cũ đã bị gỡ ---');
  const recGone = await req('GET', `/records?patientId=${p.id}`, { token: doctor.token });
  check('GET /records → 404 (đã gỡ bệnh án SOAP)', recGone.status === 404, `status=${recGone.status}`);
  const labGone = await req('GET', `/lab-results?patientId=${p.id}`, { token: doctor.token });
  check('GET /lab-results → 404 (đã gỡ xét nghiệm)', labGone.status === 404, `status=${labGone.status}`);

  console.log('\n--- 2. Bệnh lý (condition) ---');
  const c1 = await req('POST', `/conditions/patients/${p.id}/conditions`, {
    token: doctor.token,
    body: { condition: 'Đái tháo đường type 2', icd10Code: 'E11.9', status: 'chronic', onsetDate: '2020-06-01', notes: 'Kiểm soát bằng metformin' },
  });
  check('bác sĩ thêm bệnh lý → 201', c1.status === 201, JSON.stringify(c1.body));
  check('trả về note giải mã + icd10', c1.body?.notes === 'Kiểm soát bằng metformin' && c1.body?.icd10Code === 'E11.9');
  const cReadOnly = await req('POST', `/conditions/patients/${p.id}/conditions`, {
    token: reception.token,
    body: { condition: 'Tăng huyết áp' },
  });
  check('lễ tân thêm bệnh lý → 403', cReadOnly.status === 403, `status=${cReadOnly.status}`);

  console.log('\n--- 3. Dị ứng (allergy) ---');
  const a1 = await req('POST', `/conditions/patients/${p.id}/allergies`, {
    token: doctor.token,
    body: { allergyName: 'Penicillin', reaction: 'Nổi mề đay', severity: 'severe', notes: 'Tránh nhóm beta-lactam' },
  });
  check('thêm dị ứng → 201', a1.status === 201, JSON.stringify(a1.body));
  check('dị ứng: severity + note giải mã', a1.body?.severity === 'severe' && a1.body?.notes === 'Tránh nhóm beta-lactam');

  console.log('\n--- 4. Lấy tổng hợp + phân hạng ---');
  const all = await req('GET', `/conditions/patients/${p.id}`, { token: reception.token });
  check('GET trả cả bệnh lý + dị ứng', all.body?.conditions?.length === 1 && all.body?.allergies?.length === 1);

  console.log('\n--- 5. Sửa + xoá ---');
  const upd = await req('PATCH', `/conditions/conditions/${c1.body.id}`, { token: doctor.token, body: { status: 'resolved' } });
  check('sửa trạng thái bệnh lý', upd.body?.status === 'resolved');
  const delA = await req('DELETE', `/conditions/allergies/${a1.body.id}`, { token: doctor.token });
  check('xoá dị ứng → 204', delA.status === 204);
  const delC = await req('DELETE', `/conditions/conditions/${c1.body.id}`, { token: doctor.token });
  check('xoá bệnh lý → 204', delC.status === 204);

  console.log('\n--- 6. Đơn thuốc vẫn hoạt động (sau khi gỡ bệnh án) ---');
  const rx = await req('POST', '/prescriptions', {
    token: doctor.token,
    body: { patientId: p.id, medication: 'Metformin 500mg', dosage: '1 viên', frequency: '2 lần/ngày', durationDays: 30, instructions: 'Uống sau ăn' },
  });
  check('kê đơn thuốc → 201 (không cần record_id)', rx.status === 201, JSON.stringify(rx.body));
  const rxList = await req('GET', `/prescriptions?patientId=${p.id}`, { token: doctor.token });
  check('liệt kê đơn thuốc', rxList.body?.length >= 1 && rxList.body?.[0]?.instructions === 'Uống sau ăn');

  console.log('\n--- 7. Marketing vẫn segment theo bệnh lý ---');
  await req('POST', `/conditions/patients/${p.id}/conditions`, { token: doctor.token, body: { condition: 'Hen phế quản', icd10Code: 'J45', notes: 'metformin-secret-note' } });
  const seg = await req('POST', '/marketing/segments/preview', { token: admin.token, body: { criteria: { conditionLike: 'J45' } } });
  check('segment theo ICD J45 đếm được (≥1)', seg.body?.count >= 1, JSON.stringify(seg.body));

  console.log('\n--- 8. Mã hoá + audit ---');
  const rawNote = sql(`SELECT encode(notes_enc,'hex') FROM patient_medical_history WHERE patient_id='${p.id}' AND notes_enc IS NOT NULL LIMIT 1`);
  check('ghi chú bệnh lý lưu dạng mã hoá (bytea)', rawNote.length > 0 && !/metformin/i.test(Buffer.from(rawNote, 'hex').toString('utf8')));
  const auditLogged = sql(`SELECT count(*) FROM audit_logs WHERE action='CONDITION_ADD'`);
  check('audit ghi CONDITION_ADD', Number(auditLogged) >= 1);
  const phiLogged = sql(`SELECT count(*) FROM phi_access_logs WHERE patient_id='${p.id}' AND access_type='create'`);
  check('phi_access ghi lúc thêm bệnh lý/dị ứng', Number(phiLogged) >= 1);

  console.log('\n--- 9. Tìm kiếm / gợi ý ICD-10 ---');
  const byName = await req('GET', '/icd10/search?q=dai%20thao%20duong', { token: reception.token });
  check('tìm theo tên KHÔNG dấu → có E11.9', Array.isArray(byName.body) && byName.body.some((r) => r.code === 'E11.9'), JSON.stringify(byName.body?.slice(0, 2)));
  const byCode = await req('GET', '/icd10/search?q=J45', { token: doctor.token });
  check('tìm theo mã J45 → Hen phế quản', byCode.body?.some((r) => r.code === 'J45.9'));
  const codePrefixFirst = await req('GET', '/icd10/search?q=E11', { token: doctor.token });
  check('mã khớp tiền tố xếp lên đầu', codePrefixFirst.body?.[0]?.code?.startsWith('E11'));
  const empty = await req('GET', '/icd10/search?q=', { token: doctor.token });
  check('truy vấn rỗng → mảng rỗng', Array.isArray(empty.body) && empty.body.length === 0);
  const icdAuth = await fetch('http://localhost:4124/api/icd10/search?q=E11');
  check('chưa đăng nhập → 401', icdAuth.status === 401, `status=${icdAuth.status}`);

  console.log('\n==============================================');
  console.log(`  KẾT QUẢ CONDITIONS: ${pass} pass, ${fail} fail`);
  console.log('==============================================');
} catch (e) {
  console.error('LỖI:', e);
  fail++;
} finally {
  await cleanup();
  process.exit(fail === 0 ? 0 : 1);
}
