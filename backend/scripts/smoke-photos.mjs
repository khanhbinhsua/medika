import { authenticator } from 'otplib';
import { execFileSync, spawn } from 'node:child_process';

const API_PORT = 4129;
const BASE = `http://localhost:${API_PORT}/api`;
const PWD = 'DevPassword123!';
let pass = 0, fail = 0;
function check(n, ok, d = '') { if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${d}`); } }

async function req(m, p, { body, token } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (body) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* */ } return { status: r.status, body: j };
}
async function upload(p, { fields, bytes, mime, filename, token }) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`;
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', new Blob([bytes], { type: mime }), filename);
  const r = await fetch(BASE + p, { method: 'POST', headers: h, body: fd });
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

// PNG 1x1 hợp lệ
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

try {
  console.log('\n--- Chuẩn bị (cổng 4129) ---');
  backend = startBackend(); if (!(await waitHealthy())) throw new Error('backend không lên'); check('backend khởi động', true);
  const admin = await loginAs('admin@crm-dk.local');
  const doctor = await loginAs('bacsi@crm-dk.local');
  const reception = await loginAs('letan@crm-dk.local');
  const care = await loginAs('kiemtoan@crm-dk.local'); // auditor: chỉ photo:read
  check('bác sĩ có photo:write', doctor.user?.permissions?.includes('photo:write'));
  check('vai trò chỉ-đọc có photo:read nhưng KHÔNG write', care.user?.permissions?.includes('photo:read') && !care.user?.permissions?.includes('photo:write'));
  check('lễ tân KHÔNG có photo:read', !reception.user?.permissions?.includes('photo:read'));

  const run = Date.now().toString().slice(-6);
  const p = (await req('POST', '/patients', { token: admin.token, body: { firstName: 'Anh Truoc Sau', lastName: 'Test', dob: '1990-01-01', phone: `096${run}` } })).body;

  console.log('\n--- 1. RBAC upload ---');
  check('lễ tân upload ảnh → 403', (await upload('/photos', { token: reception.token, fields: { patientId: p.id, category: 'before' }, bytes: PNG, mime: 'image/png', filename: 'x.png' })).status === 403);
  check('vai trò chỉ-đọc upload → 403', (await upload('/photos', { token: care.token, fields: { patientId: p.id, category: 'before' }, bytes: PNG, mime: 'image/png', filename: 'x.png' })).status === 403);

  console.log('\n--- 2. Upload + metadata ---');
  const before = await upload('/photos', { token: doctor.token, fields: { patientId: p.id, category: 'before', bodyArea: 'Mặt', caption: 'Trước điều trị nám', takenAt: '2026-11-01' }, bytes: PNG, mime: 'image/png', filename: 'before.png' });
  check('upload ảnh "before" → 201', before.status === 201, `status=${before.status}`);
  check('metadata đúng (category/vùng/ngày/caption)', before.body?.category === 'before' && before.body?.bodyArea === 'Mặt' && before.body?.takenAt === '2026-11-01' && before.body?.caption === 'Trước điều trị nám');
  const after = await upload('/photos', { token: doctor.token, fields: { patientId: p.id, category: 'after', bodyArea: 'Mặt', takenAt: '2026-11-20' }, bytes: PNG, mime: 'image/png', filename: 'after.png' });
  check('upload ảnh "after" → 201', after.status === 201);
  await upload('/photos', { token: doctor.token, fields: { patientId: p.id, category: 'before', bodyArea: 'Mũi' }, bytes: PNG, mime: 'image/png', filename: 'nose.png' });

  console.log('\n--- 3. Từ chối định dạng nguy hiểm ---');
  const svg = await upload('/photos', { token: doctor.token, fields: { patientId: p.id, category: 'before' }, bytes: Buffer.from('<svg/>'), mime: 'image/svg+xml', filename: 'x.svg' });
  check('SVG bị từ chối → 400', svg.status === 400, `status=${svg.status}`);

  console.log('\n--- 4. Mã hoá tại chỗ ---');
  const raw = sql(`SELECT encode(caption_enc,'hex') FROM clinical_photos WHERE id='${before.body.id}'`);
  check('caption lưu mã hoá (không plaintext)', raw.length > 0 && !/Truớc|Truoc dieu tri/i.test(Buffer.from(raw, 'hex').toString('utf8')));
  const diskBytes = sql(`SELECT octet_length(file_dek_enc) FROM clinical_photos WHERE id='${before.body.id}'`);
  check('ảnh có DEK riêng được wrap', Number(diskBytes) > 0);

  console.log('\n--- 5. Danh sách + nhóm theo vùng ---');
  const list = await req('GET', `/photos?patientId=${p.id}`, { token: doctor.token });
  check('liệt kê 3 ảnh (có tên người tải)', list.body?.length === 3 && !!list.body?.[0]?.uploadedByName);
  // Cùng một vùng phải nằm liền kề (gom nhóm), không xen kẽ — bất kể thứ tự collation.
  const areas = (list.body ?? []).map((x) => x.bodyArea);
  const contiguous = areas.every((a, i) => i === 0 || a === areas[i - 1] || !areas.slice(0, i).includes(a));
  check('ảnh gom nhóm theo vùng (liền kề)', contiguous, JSON.stringify(areas));
  check('vai trò chỉ-đọc xem được ảnh', (await req('GET', `/photos?patientId=${p.id}`, { token: care.token })).body?.length === 3);

  console.log('\n--- 6. Tải ảnh (giải mã + checksum) ---');
  const img = await fetch(`${BASE}/photos/${before.body.id}/image`, { headers: { Authorization: `Bearer ${doctor.token}` } });
  const imgBuf = Buffer.from(await img.arrayBuffer());
  check('tải ảnh → 200 image/png, byte khớp gốc', img.status === 200 && img.headers.get('content-type') === 'image/png' && imgBuf.equals(PNG));
  check('vai trò chỉ-đọc tải được ảnh', (await fetch(`${BASE}/photos/${before.body.id}/image`, { headers: { Authorization: `Bearer ${care.token}` } })).status === 200);
  check('lễ tân tải ảnh → 403', (await fetch(`${BASE}/photos/${before.body.id}/image`, { headers: { Authorization: `Bearer ${reception.token}` } })).status === 403);

  console.log('\n--- 7. Xoá mềm + audit ---');
  check('vai trò chỉ-đọc xoá ảnh → 403', (await req('DELETE', `/photos/${after.body.id}`, { token: care.token })).status === 403);
  check('bác sĩ xoá ảnh → 204', (await req('DELETE', `/photos/${after.body.id}`, { token: doctor.token })).status === 204);
  check('ảnh đã xoá không còn trong danh sách', (await req('GET', `/photos?patientId=${p.id}`, { token: doctor.token })).body?.length === 2);
  check('audit PHOTO_UPLOAD + PHOTO_DELETE', Number(sql(`SELECT count(*) FROM audit_logs WHERE entity_type='clinical_photo' AND action IN ('PHOTO_UPLOAD','PHOTO_DELETE')`)) >= 4);

  console.log('\n==============================================');
  console.log(`  KẾT QUẢ PHOTOS: ${pass} pass, ${fail} fail`);
  console.log('==============================================');
} catch (e) { console.error('LỖI:', e); fail++; } finally { await cleanup(); process.exit(fail === 0 ? 0 : 1); }
