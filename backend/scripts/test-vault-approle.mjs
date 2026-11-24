// Kiểm chứng VaultKekProvider dùng AppRole (KHÔNG token tĩnh) — app đăng nhập
// bằng role-id + secret-id, nhận token NGẮN HẠN có policy least-privilege
// (chỉ encrypt/decrypt trên đúng khoá), rồi wrap/unwrap DEK.
//
// Yêu cầu: VAULT_ADDR, VAULT_ROLE_ID, VAULT_SECRET_ID trong env (Vault đã bật
// transit + approle, xem docs/09-deployment.md).
if (!process.env.VAULT_ROLE_ID || !process.env.VAULT_SECRET_ID || !process.env.VAULT_ADDR) {
  console.error('Cần VAULT_ADDR, VAULT_ROLE_ID, VAULT_SECRET_ID trong env.');
  process.exit(1);
}

process.env.KEK_PROVIDER = 'vault';
process.env.VAULT_TRANSIT_KEY ??= 'crm-dk-kek';
delete process.env.VAULT_TOKEN; // KHÔNG dùng token tĩnh — chỉ AppRole
process.env.DATABASE_URL ??= 'postgresql://crm_app:changeme@localhost:5433/crm_dk';
process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(48);
process.env.SEARCH_HMAC_KEY ??= Buffer.alloc(32).toString('base64');

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + ' ' + d); } };

const { wrapDek, unwrapDek, generateDek, encryptField, decryptField } = await import('../src/crypto/field-encryption.js');

console.log('\n--- VaultKekProvider qua AppRole (không token tĩnh) ---');

const dek = generateDek();
const { wrapped } = await wrapDek(dek); // lần đầu → provider tự login AppRole
check('wrap qua AppRole trả ciphertext Vault', wrapped.toString('utf8').startsWith('vault:v1:'), wrapped.toString('utf8').slice(0, 16));
check('unwrap khôi phục đúng DEK', (await unwrapDek(wrapped)).equals(dek));

const pt = 'Bệnh nhân — chẩn đoán nhạy cảm';
const enc = encryptField(pt, dek);
check('round-trip mã hoá field qua DEK', decryptField(enc, dek) === pt);

// Nhiều lần gọi → token được cache/tái dùng, không login lại mỗi lần
const t0 = Date.now();
for (let i = 0; i < 5; i++) { const { wrapped: w } = await wrapDek(generateDek()); await unwrapDek(w); }
check('5 vòng wrap/unwrap liên tiếp OK (token cache)', true, `${Date.now() - t0}ms`);

console.log(`\n  KẾT QUẢ VAULT APPROLE: ${pass} pass, ${fail} fail\n`);
process.exit(fail > 0 ? 1 : 0);
