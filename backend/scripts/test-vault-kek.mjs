// Kiểm chứng VaultKekProvider bằng Vault dev THẬT (không mock).
// Chạy qua env KEK_PROVIDER=vault để đúng đường code production sẽ dùng.
import { randomBytes } from 'node:crypto';

process.env.KEK_PROVIDER = 'vault';
process.env.VAULT_ADDR = 'http://localhost:8201';
process.env.VAULT_TOKEN = 'roottoken';
process.env.VAULT_TRANSIT_KEY = 'crm-dk-kek';
// Các biến bắt buộc khác để env.ts parse được.
process.env.DATABASE_URL ??= 'postgresql://crm_app:changeme@localhost:5433/crm_dk';
process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(48);
process.env.SEARCH_HMAC_KEY ??= Buffer.alloc(32).toString('base64');

let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${d}`); } };

const { wrapDek, unwrapDek, generateDek } = await import('../src/crypto/field-encryption.js');
const { encryptField, decryptField } = await import('../src/crypto/field-encryption.js');

console.log('\n--- VaultKekProvider (Transit engine thật) ---');

// 1. Wrap/unwrap round-trip
const dek = generateDek();
const { wrapped, kekReference } = await wrapDek(dek);
check('wrap trả về ciphertext Vault', wrapped.toString('utf8').startsWith('vault:v1:'), wrapped.toString('utf8').slice(0, 20));
check('kekReference đúng', kekReference === 'vault:transit:crm-dk-kek', kekReference);

const unwrapped = await unwrapDek(wrapped);
check('unwrap khôi phục đúng DEK gốc', unwrapped.equals(dek));

// 2. Wrapped KHÁC plaintext (khoá gốc không lộ)
check('ciphertext không chứa DEK thô', !wrapped.includes(dek));

// 3. Round-trip mã hoá field qua DEK đã unwrap từ Vault
const plaintext = 'Nguyễn Văn Bệnh Nhân — HIV dương tính';
const enc = encryptField(plaintext, unwrapped);
check('field mã hoá được', enc.length > plaintext.length);
check('giải mã field khớp gốc', decryptField(enc, unwrapped) === plaintext);

// 4. Hai lần wrap cùng DEK cho ciphertext KHÁC nhau (Vault có convergent=false → IV ngẫu nhiên)
const { wrapped: w2 } = await wrapDek(dek);
check('wrap hai lần cho ciphertext khác nhau (IV ngẫu nhiên)', !wrapped.equals(w2));
check('cả hai đều unwrap về đúng DEK', (await unwrapDek(w2)).equals(dek));

console.log(`\n${'='.repeat(46)}\n  KẾT QUẢ VAULT KEK: ${pass} pass, ${fail} fail\n${'='.repeat(46)}\n`);
process.exit(fail > 0 ? 1 : 0);
