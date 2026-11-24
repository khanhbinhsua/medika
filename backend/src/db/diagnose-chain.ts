import { createHash } from 'node:crypto';
import { db, closeDatabase } from './index.js';

/** Công cụ chẩn đoán: in ra vì sao một dòng audit không khớp hash. */
async function main() {
  const ids = process.argv.slice(2);
  let q = db.selectFrom('audit_logs').selectAll().orderBy('id', 'asc');
  if (ids.length > 0) q = q.where('id', 'in', ids);
  else q = q.limit(3);
  const rows = await q.execute();

  for (const row of rows) {
    const canonical = JSON.stringify({
      prevHash: row.prev_hash,
      requestId: row.request_id,
      actorId: row.actor_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      changes: row.changes ?? null,
      outcome: row.outcome,
      createdAt: row.created_at.toISOString(),
    });

    const recomputed = createHash('sha256').update(canonical).digest('hex');

    console.log(`\n── dòng id=${row.id} ─────────────────────────────`);
    console.log('action      :', row.action);
    console.log('created_at  :', row.created_at.toISOString());
    console.log('  kiểu JS   :', Object.prototype.toString.call(row.created_at));
    console.log('changes     :', JSON.stringify(row.changes));
    console.log('outcome     :', JSON.stringify(row.outcome));
    console.log('canonical   :', canonical);
    console.log('hash lưu    :', row.entry_hash);
    console.log('hash tính lại:', recomputed);
    console.log('KHỚP        :', recomputed === row.entry_hash ? 'CÓ' : 'KHÔNG');
  }
}

main()
  .then(() => closeDatabase())
  .catch(async (err) => {
    console.error(err);
    await closeDatabase();
    process.exit(1);
  });
