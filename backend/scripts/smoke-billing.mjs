import { authenticator } from 'otplib';
import { execFileSync, spawn } from 'node:child_process';

const API_PORT = 4127;
const BASE = `http://localhost:${API_PORT}/api`;
const PWD = 'DevPassword123!';
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
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, body: json };
}
function sql(q) { return execFileSync('docker', ['exec', 'crm-dk-postgres', 'psql', '-U', 'crm_app', '-d', 'crm_dk', '-t', '-A', '-c', q], { encoding: 'utf8' }).trim(); }
async function loginAs(email) {
  const first = await req('POST', '/auth/login', { body: { email, password: PWD } });
  if (!first.body?.mfaEnrollmentRequired) throw new Error(`${email}: cần reset MFA`);
  const token = first.body.enrollmentToken;
  const start = await req('POST', '/auth/mfa/enroll/start', { body: { enrollmentToken: token } });
  const secret = new URL(start.body.otpauthUrl).searchParams.get('secret');
  const done = await req('POST', '/auth/mfa/enroll/confirm', { body: { enrollmentToken: token, code: authenticator.generate(secret) } });
  return { token: done.body?.accessToken, user: done.body?.user };
}
function startBackend() {
  const child = spawn('npx', ['tsx', 'src/server.ts'], { cwd: process.cwd(), shell: true, env: { ...process.env, PORT: String(API_PORT), LOG_LEVEL: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => process.stdout.write(`[api:err] ${d}`));
  return child;
}
async function waitHealthy(ms = 30000) { const s = Date.now(); while (Date.now() - s < ms) { try { if ((await fetch(`http://localhost:${API_PORT}/api/health`)).ok) return true; } catch { /* */ } await new Promise((r) => setTimeout(r, 500)); } return false; }
let backend;
async function cleanup() { if (!backend) return; if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(backend.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* */ } } else backend.kill('SIGTERM'); }

try {
  console.log('\n--- Chuẩn bị: backend riêng (cổng 4127) ---');
  backend = startBackend();
  if (!(await waitHealthy())) throw new Error('backend không lên');
  check('backend khởi động', true);
  const admin = await loginAs('admin@crm-dk.local');
  const doctor = await loginAs('bacsi@crm-dk.local');
  check('admin có billing:manage', admin.user?.permissions?.includes('billing:manage'));
  check('bác sĩ có billing:read, KHÔNG manage', doctor.user?.permissions?.includes('billing:read') && !doctor.user?.permissions?.includes('billing:manage'));

  const run = Date.now().toString().slice(-6);
  const patient = (await req('POST', '/patients', { token: admin.token, body: { firstName: 'POS', lastName: 'Khách', dob: '1992-02-02', phone: `096${run}` } })).body;

  console.log('\n--- 1. Danh mục ---');
  const cat = await req('GET', '/billing/catalog', { token: admin.token });
  check('catalog có dịch vụ + gói', (cat.body?.services?.length ?? 0) >= 1 && (cat.body?.packages?.length ?? 0) >= 1);
  const service = cat.body.services.find((s) => s.priceVnd > 0);
  const pkg = cat.body.packages[0];

  console.log('\n--- 2. RBAC ---');
  const docCreate = await req('POST', '/billing/orders', { token: doctor.token, body: { patientId: patient.id } });
  check('bác sĩ tạo đơn → 403', docCreate.status === 403, `status=${docCreate.status}`);

  console.log('\n--- 3. Tạo đơn + thêm dòng ---');
  const order = (await req('POST', '/billing/orders', { token: admin.token, body: { patientId: patient.id } })).body;
  check('tạo đơn → có mã DH + status draft', /^DH-\d{6}$/.test(order?.code ?? '') && order?.status === 'draft', JSON.stringify(order?.code));
  const oid = order.id;
  const afterSvc = (await req('POST', `/billing/orders/${oid}/lines`, { token: admin.token, body: { serviceId: service.id, qty: 1 } })).body;
  check('thêm dịch vụ → tổng đúng', afterSvc.totalVnd === service.priceVnd && afterSvc.status === 'unpaid', `total=${afterSvc.totalVnd}`);
  const afterPkg = (await req('POST', `/billing/orders/${oid}/lines`, { token: admin.token, body: { packageId: pkg.id, qty: 1 } })).body;
  const expectedTotal = service.priceVnd + pkg.priceVnd;
  check('thêm gói → tổng = dịch vụ + gói', afterPkg.totalVnd === expectedTotal, `total=${afterPkg.totalVnd} expect=${expectedTotal}`);

  console.log('\n--- 4. Thu một phần → công nợ ---');
  const half = Math.floor(expectedTotal / 2);
  const partial = (await req('POST', `/billing/orders/${oid}/payments`, { token: admin.token, body: { method: 'cash', amountVnd: half } })).body;
  check('thu một phần → status partial', partial.status === 'partial' && partial.paidVnd === half, JSON.stringify({ s: partial.status, paid: partial.paidVnd }));
  check('còn lại đúng', partial.remainingVnd === expectedTotal - half);
  const over = await req('POST', `/billing/orders/${oid}/payments`, { token: admin.token, body: { method: 'cash', amountVnd: expectedTotal } });
  check('thu quá số còn lại → 400', over.status === 400, `status=${over.status}`);
  const recv = await req('GET', '/billing/orders/receivables', { token: admin.token });
  check('công nợ gồm đơn này', recv.body?.items?.some((o) => o.id === oid) && recv.body.total >= expectedTotal - half);

  console.log('\n--- 5. Thu đủ → paid + sinh thẻ buổi ---');
  const paid = (await req('POST', `/billing/orders/${oid}/payments`, { token: admin.token, body: { method: 'transfer', amountVnd: expectedTotal - half } })).body;
  check('thu đủ → status paid, còn lại 0', paid.status === 'paid' && paid.remainingVnd === 0);
  const cpCount = sql(`SELECT count(*) FROM customer_packages WHERE order_id='${oid}'`);
  check('sinh thẻ buổi cho gói đã mua', Number(cpCount) === 1, `got ${cpCount}`);
  const cpTotal = sql(`SELECT total FROM customer_packages WHERE order_id='${oid}'`);
  check('số buổi thẻ = qty gói', Number(cpTotal) === pkg.qty, `got ${cpTotal} expect ${pkg.qty}`);
  const addAfterPaid = await req('POST', `/billing/orders/${oid}/lines`, { token: admin.token, body: { serviceId: service.id } });
  check('đơn đã chốt → không thêm dòng (409)', addAfterPaid.status === 409, `status=${addAfterPaid.status}`);

  console.log('\n--- 6. Sổ thanh toán + lọc ---');
  const ledger = await req('GET', '/billing/orders?status=paid', { token: doctor.token });
  check('bác sĩ xem sổ (read) + lọc paid gồm đơn', ledger.status === 200 && ledger.body?.some((o) => o.id === oid));

  console.log('\n--- 7. Audit ---');
  check('audit ORDER_CREATE', Number(sql(`SELECT count(*) FROM audit_logs WHERE action='ORDER_CREATE' AND entity_id='${oid}'`)) >= 1);
  check('audit PAYMENT_TAKE', Number(sql(`SELECT count(*) FROM audit_logs WHERE action='PAYMENT_TAKE' AND entity_id='${oid}'`)) >= 2);

  console.log('\n==============================================');
  console.log(`  KẾT QUẢ BILLING: ${pass} pass, ${fail} fail`);
  console.log('==============================================');
} catch (e) { console.error('LỖI:', e); fail++; } finally { await cleanup(); process.exit(fail === 0 ? 0 : 1); }
