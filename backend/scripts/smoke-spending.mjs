import { authenticator } from 'otplib';
import { execFileSync, spawn } from 'node:child_process';

const API_PORT = 4123;
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
  console.log('\n--- Chuẩn bị: backend riêng (cổng 4123) ---');
  backend = startBackend();
  const healthy = await waitHealthy();
  check('backend khởi động', healthy);
  if (!healthy) throw new Error('backend không lên');

  const admin = await loginAs('admin@crm-dk.local');
  const reception = await loginAs('letan@crm-dk.local'); // spending:write
  const doctor = await loginAs('bacsi@crm-dk.local'); // spending:read
  const auditor = await loginAs('kiemtoan@crm-dk.local'); // spending:read
  check('đăng nhập 4 vai trò', !!(admin.token && reception.token && doctor.token && auditor.token));
  check('lễ tân có spending:write', reception.user?.permissions?.includes('spending:write'));
  check('bác sĩ KHÔNG có spending:write', !doctor.user?.permissions?.includes('spending:write'));

  const run = Date.now().toString().slice(-8);
  const mk = (fn) =>
    req('POST', '/patients', {
      token: admin.token,
      body: { firstName: fn, lastName: 'Chi', dob: '1990-05-05', gender: 'other', phone: `09${run}${fn.length}` },
    });
  const pHigh = (await mk('Cao')).body;
  const pLow = (await mk('Thap')).body;
  check('tạo 2 bệnh nhân + có MRN', !!(pHigh?.id && pHigh?.mrn && pLow?.id && pLow?.mrn));

  console.log('\n--- 1. Ghi khoản chi (manual) ---');
  const t1 = await req('POST', `/spending/patients/${pHigh.id}/transactions`, {
    token: reception.token,
    body: { occurredAt: '2026-08-01', amount: 12000000, category: 'thu_thuat', note: 'Niềng răng đợt 1' },
  });
  check('lễ tân ghi khoản chi → 201', t1.status === 201, JSON.stringify(t1.body));
  check('trả về note đã giải mã', t1.body?.note === 'Niềng răng đợt 1');
  check('amount đúng kiểu số', t1.body?.amount === 12000000);
  const t2 = await req('POST', `/spending/patients/${pHigh.id}/transactions`, {
    token: reception.token,
    body: { occurredAt: '2026-08-10', amount: 18000000, category: 'thu_thuat' },
  });
  check('ghi khoản chi thứ 2 → 201', t2.status === 201);
  await req('POST', `/spending/patients/${pLow.id}/transactions`, {
    token: reception.token,
    body: { occurredAt: '2026-08-05', amount: 1000000, category: 'kham' },
  });

  console.log('\n--- 2. RBAC ghi ---');
  const docWrite = await req('POST', `/spending/patients/${pHigh.id}/transactions`, {
    token: doctor.token,
    body: { occurredAt: '2026-08-01', amount: 500000 },
  });
  check('bác sĩ ghi khoản chi → 403', docWrite.status === 403, `status=${docWrite.status}`);

  console.log('\n--- 3. Tổng hợp + hạng VIP ---');
  const sum = await req('GET', `/spending/patients/${pHigh.id}/summary`, { token: doctor.token });
  check('tổng chi tiêu = 30.000.000', sum.body?.total === 30000000, `total=${sum.body?.total}`);
  check('số khoản = 2', sum.body?.count === 2, `count=${sum.body?.count}`);
  check('hạng = Vàng (≥20tr)', sum.body?.tier?.code === 'vang', JSON.stringify(sum.body?.tier));
  check('có phân rã theo tháng', Array.isArray(sum.body?.byMonth) && sum.body.byMonth.length >= 1);
  check('có phân rã theo nhóm', sum.body?.byCategory?.some((c) => c.category === 'thu_thuat'));
  const sumLow = await req('GET', `/spending/patients/${pLow.id}/summary`, { token: doctor.token });
  check('khách chi ít → hạng Thường', sumLow.body?.tier?.code === 'thuong', JSON.stringify(sumLow.body?.tier));

  console.log('\n--- 4. Danh sách + sửa + xoá ---');
  const list = await req('GET', `/spending/patients/${pHigh.id}/transactions`, { token: reception.token });
  check('liệt kê 2 khoản chi', list.body?.length === 2, `len=${list.body?.length}`);
  const upd = await req('PATCH', `/spending/transactions/${t1.body.id}`, {
    token: reception.token,
    body: { amount: 10000000, note: 'Niềng răng (điều chỉnh)' },
  });
  check('sửa khoản chi → note mới', upd.body?.note === 'Niềng răng (điều chỉnh)' && upd.body?.amount === 10000000);
  const sum2 = await req('GET', `/spending/patients/${pHigh.id}/summary`, { token: reception.token });
  check('tổng cập nhật = 28.000.000', sum2.body?.total === 28000000, `total=${sum2.body?.total}`);
  const del = await req('DELETE', `/spending/transactions/${t2.body.id}`, { token: reception.token });
  check('xoá khoản chi → 204', del.status === 204);
  const sum3 = await req('GET', `/spending/patients/${pHigh.id}/summary`, { token: reception.token });
  check('tổng sau xoá = 10.000.000', sum3.body?.total === 10000000, `total=${sum3.body?.total}`);

  console.log('\n--- 5. Nhập hàng loạt (CSV) ---');
  const imp = await req('POST', '/spending/import', {
    token: reception.token,
    body: {
      rows: [
        { mrn: pHigh.mrn, occurredAt: '2026-07-01', amount: 25000000, category: 'thuoc', note: 'Nhập từ HIS cũ' },
        { mrn: pLow.mrn, occurredAt: '2026-07-02', amount: 3000000, category: 'cls' },
        { mrn: 'KHONG-CO-MRN', occurredAt: '2026-07-03', amount: 999, category: 'khac' },
      ],
    },
  });
  check('import 2 dòng, bỏ 1 dòng lạ', imp.body?.imported === 2 && imp.body?.skipped?.length === 1, JSON.stringify(imp.body));
  const sum4 = await req('GET', `/spending/patients/${pHigh.id}/summary`, { token: reception.token });
  check('tổng sau import = 35.000.000', sum4.body?.total === 35000000, `total=${sum4.body?.total}`);
  check('hạng lên Kim cương (≥50tr)?', sum4.body?.tier?.code === 'vang', `tier=${sum4.body?.tier?.code}`); // 35tr vẫn Vàng

  console.log('\n--- 6. Khách chi nhiều nhất + hạng ---');
  const top = await req('GET', '/spending/top?limit=200', { token: auditor.token });
  const mine = top.body?.find?.((r) => r.patientId === pHigh.id);
  check('top gồm khách của mình', !!mine, 'không thấy');
  check('top: tổng đúng + có tên giải mã', mine?.total === 35000000 && /Cao/.test(mine?.name ?? ''), JSON.stringify(mine));
  check('top: hạng Vàng', mine?.tier?.code === 'vang');
  const topVang = await req('GET', '/spending/top?tier=vang&limit=200', { token: reception.token });
  check('lọc theo hạng vàng gồm khách VIP', topVang.body?.some((r) => r.patientId === pHigh.id));
  check('lọc hạng vàng KHÔNG gồm khách chi ít', !topVang.body?.some((r) => r.patientId === pLow.id));

  console.log('\n--- 7. Danh mục hạng ---');
  const tiers = await req('GET', '/spending/tiers', { token: doctor.token });
  check('4 hạng VIP', tiers.body?.length === 4 && tiers.body?.[3]?.code === 'kim_cuong');

  console.log('\n--- 8. Nhóm marketing theo chi tiêu (VIP segment) ---');
  const seg = await req('POST', '/marketing/segments/preview', {
    token: reception.token,
    body: { criteria: { minTotalSpend: 20000000 } },
  });
  check('preview segment chi ≥20tr đếm được', typeof seg.body?.count === 'number', JSON.stringify(seg.body));
  const segLow = await req('POST', '/marketing/segments/preview', {
    token: reception.token,
    body: { criteria: { minTotalSpend: 20000000, maxTotalSpend: 30000000 } },
  });
  check('preview segment 20–30tr chạy được', typeof segLow.body?.count === 'number');

  console.log('\n--- 9. Audit + phi_access ---');
  const addLogged = sql(`SELECT count(*) FROM audit_logs WHERE action='SPENDING_ADD' AND entity_id='${t1.body.id}'`);
  check('audit ghi SPENDING_ADD', Number(addLogged) >= 1);
  const impLogged = sql(`SELECT count(*) FROM audit_logs WHERE action='SPENDING_IMPORT'`);
  check('audit ghi SPENDING_IMPORT', Number(impLogged) >= 1);
  const phi = sql(`SELECT count(*) FROM phi_access_logs WHERE patient_id='${pHigh.id}' AND access_type='create'`);
  check('phi_access ghi lúc tạo khoản chi', Number(phi) >= 1);

  console.log('\n==============================================');
  console.log(`  KẾT QUẢ SPENDING: ${pass} pass, ${fail} fail`);
  console.log('==============================================');
} catch (e) {
  console.error('LỖI:', e);
  fail++;
} finally {
  await cleanup();
  process.exit(fail === 0 ? 0 : 1);
}
