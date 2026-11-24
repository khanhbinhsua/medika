import { authenticator } from 'otplib';
import { execFileSync, spawn } from 'node:child_process';

const API_PORT = 4128;
const BASE = `http://localhost:${API_PORT}/api`;
const PWD = 'DevPassword123!';
let pass = 0, fail = 0;
function check(n, ok, d = '') { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${d}`); } }
async function req(m, p, { body, token } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* */ } return { status: r.status, body: j };
}
function sql(q) { return execFileSync('docker', ['exec', 'crm-dk-postgres', 'psql', '-U', 'crm_app', '-d', 'crm_dk', '-t', '-A', '-c', q], { encoding: 'utf8' }).trim(); }
async function loginAs(email) {
  const f = await req('POST', '/auth/login', { body: { email, password: PWD } });
  if (!f.body?.mfaEnrollmentRequired) throw new Error(`${email}: cần reset MFA`);
  const s = await req('POST', '/auth/mfa/enroll/start', { body: { enrollmentToken: f.body.enrollmentToken } });
  const secret = new URL(s.body.otpauthUrl).searchParams.get('secret');
  const d = await req('POST', '/auth/mfa/enroll/confirm', { body: { enrollmentToken: f.body.enrollmentToken, code: authenticator.generate(secret) } });
  return { token: d.body?.accessToken, user: d.body?.user };
}
function startBackend() { const c = spawn('npx', ['tsx', 'src/server.ts'], { cwd: process.cwd(), shell: true, env: { ...process.env, PORT: String(API_PORT), LOG_LEVEL: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'] }); c.stderr.on('data', (d) => process.stdout.write(`[api:err] ${d}`)); return c; }
async function waitHealthy(ms = 30000) { const s = Date.now(); while (Date.now() - s < ms) { try { if ((await fetch(`http://localhost:${API_PORT}/api/health`)).ok) return true; } catch { /* */ } await new Promise((r) => setTimeout(r, 500)); } return false; }
let backend; async function cleanup() { if (!backend) return; if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(backend.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* */ } } else backend.kill('SIGTERM'); }

try {
  console.log('\n--- Chuẩn bị (cổng 4128) ---');
  backend = startBackend(); if (!(await waitHealthy())) throw new Error('backend không lên'); check('backend khởi động', true);
  const admin = await loginAs('admin@crm-dk.local');
  const doctor = await loginAs('bacsi@crm-dk.local');
  const nurse = await loginAs('yta@crm-dk.local');
  const reception = await loginAs('letan@crm-dk.local');
  check('bác sĩ có encounter:write', doctor.user?.permissions?.includes('encounter:write'));
  check('lễ tân KHÔNG có encounter:read', !reception.user?.permissions?.includes('encounter:read'));

  const run = Date.now().toString().slice(-6);
  const p = (await req('POST', '/patients', { token: admin.token, body: { firstName: 'Benh An', lastName: 'Test', dob: '1988-08-08', phone: `094${run}` } })).body;

  console.log('\n--- 1. RBAC ---');
  check('lễ tân tạo bệnh án → 403', (await req('POST', '/encounters', { token: reception.token, body: { patientId: p.id } })).status === 403);

  console.log('\n--- 2. Tạo + ghi 15/BV1 ---');
  const enc = (await req('POST', '/encounters', { token: doctor.token, body: { patientId: p.id } })).body;
  check('tạo bệnh án → draft', enc?.status === 'draft', JSON.stringify(enc?.status));
  const eid = enc.id;
  const upd = await req('PATCH', `/encounters/${eid}`, { token: doctor.token, body: {
    reason: 'Đau ngực trái 3 ngày', history: 'Khởi phát sau gắng sức, tăng dần',
    vitals: { pulse: '88', temp: '37', bp: '140/90', resp: '18', weight: '68' },
    examGeneral: 'Tỉnh, da niêm hồng', examOrgans: 'Tim đều, phổi trong',
    dxPrimaryIcd10: 'I20.9', dxSecondaryIcd10: ['E11.9'], treatment: 'Nghỉ ngơi, kê đơn',
  } });
  check('ghi nội dung → 200 + giải mã đúng', upd.status === 200 && upd.body?.reason === 'Đau ngực trái 3 ngày' && upd.body?.vitals?.bp === '140/90', JSON.stringify(upd.body?.reason));
  check('chẩn đoán ICD chính + kèm', upd.body?.dxPrimaryIcd10 === 'I20.9' && upd.body?.dxSecondaryIcd10?.includes('E11.9'));

  console.log('\n--- 2b. Kê đơn thuốc nối bệnh án (S15) ---');
  const rx1 = await req('POST', '/prescriptions', { token: doctor.token, body: {
    patientId: p.id, encounterId: eid, medication: 'Aspirin', dosage: '81mg', frequency: '1 lần/ngày', durationDays: 30,
  } });
  check('kê đơn (gắn encounterId) → 201', rx1.status === 201, `status=${rx1.status}`);
  const rxOther = await req('POST', '/prescriptions', { token: doctor.token, body: {
    patientId: p.id, medication: 'Paracetamol', dosage: '500mg', frequency: 'khi sốt',
  } });
  check('kê đơn không gắn encounter → 201', rxOther.status === 201);
  const byEnc = await req('GET', `/prescriptions?patientId=${p.id}&encounterId=${eid}`, { token: doctor.token });
  check('lọc đơn theo encounter → chỉ 1 đơn của lần khám', byEnc.body?.length === 1 && byEnc.body?.[0]?.medication === 'Aspirin', JSON.stringify(byEnc.body?.map((x) => x.medication)));
  check('DB: encounter_id khớp', sql(`SELECT encounter_id FROM prescriptions WHERE id='${byEnc.body?.[0]?.id}'`) === eid);

  console.log('\n--- 3. Mã hoá tại chỗ ---');
  const raw = sql(`SELECT encode(reason_enc,'hex') FROM encounters WHERE id='${eid}'`);
  check('lý do khám lưu mã hoá (không plaintext)', raw.length > 0 && !/Đau ngực|Dau nguc/i.test(Buffer.from(raw, 'hex').toString('utf8')));

  console.log('\n--- 4. Ký + khoá ---');
  check('người khác ký thay → 403', (await req('POST', `/encounters/${eid}/sign`, { token: nurse.token })).status === 403);
  const sign = await req('POST', `/encounters/${eid}/sign`, { token: doctor.token });
  check('bác sĩ lập ký → signed + locked', sign.body?.status === 'signed' && sign.body?.locked === true);
  check('sửa sau ký → 409', (await req('PATCH', `/encounters/${eid}`, { token: doctor.token, body: { reason: 'sửa lén' } })).status === 409);

  console.log('\n--- 5. Sửa bổ sung (amend) ---');
  const noReason = await req('POST', `/encounters/${eid}/amend`, { token: doctor.token, body: { treatment: 'Bổ sung' } });
  check('amend thiếu lý do → 400', noReason.status === 400, `status=${noReason.status}`);
  const amend = await req('POST', `/encounters/${eid}/amend`, { token: doctor.token, body: { treatment: 'Thêm Aspirin 81mg', changeReason: 'Bổ sung điều trị' } });
  check('amend → status amended + giá trị mới', amend.body?.status === 'amended' && amend.body?.treatment === 'Thêm Aspirin 81mg');
  const vers = await req('GET', `/encounters/${eid}/versions`, { token: doctor.token });
  check('có 1 bản cũ (snapshot)', vers.body?.length === 1 && vers.body?.[0]?.changeReason === 'Bổ sung điều trị');
  check('snapshot giữ giá trị trước amend', vers.body?.[0]?.snapshot?.treatment === 'Nghỉ ngơi, kê đơn');

  console.log('\n--- 6. Danh sách + audit ---');
  const list = await req('GET', `/encounters/patients/${p.id}`, { token: doctor.token });
  check('liệt kê bệnh án của BN (có ICD + tên BS)', list.body?.length === 1 && list.body?.[0]?.dxPrimaryIcd10 === 'I20.9' && !!list.body?.[0]?.doctorName);
  check('audit ENCOUNTER_SIGN + AMEND', Number(sql(`SELECT count(*) FROM audit_logs WHERE entity_id='${eid}' AND action IN ('ENCOUNTER_SIGN','ENCOUNTER_AMEND')`)) >= 2);

  console.log('\n==============================================');
  console.log(`  KẾT QUẢ ENCOUNTERS: ${pass} pass, ${fail} fail`);
  console.log('==============================================');
} catch (e) { console.error('LỖI:', e); fail++; } finally { await cleanup(); process.exit(fail === 0 ? 0 : 1); }
