import type { Transaction } from 'kysely';
import { db } from '../../db/index.js';
import type { Database } from '../../db/types.js';
import { writeAuditLog, writePhiAccessLog } from '../../audit/audit-logger.js';
import { NotFoundError, ValidationError, ConflictError } from '../../middleware/errors.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import type { CreateOrderInput, AddLineInput, TakePaymentInput, ListOrdersQuery } from './billing.schemas.js';

type Db = typeof db | Transaction<Database>;
const n = (v: unknown) => Number(v ?? 0);

export interface CatalogDto {
  services: { id: string; name: string; category: string | null; priceVnd: number }[];
  packages: { id: string; name: string; unit: string; qty: number; priceVnd: number; validityDays: number | null }[];
}
export interface OrderLineDto {
  id: string; kind: string; name: string; qty: number; unitPriceVnd: number; discountVnd: number; amountVnd: number;
}
export interface PaymentDto {
  id: string; method: string; amountVnd: number; paidAt: string;
}
export interface OrderDto {
  id: string; code: string; patientId: string; patientMrn?: string; status: string;
  totalVnd: number; paidVnd: number; remainingVnd: number; note: string | null; createdAt: string;
  lines: OrderLineDto[]; payments: PaymentDto[];
}

export async function getCatalog(): Promise<CatalogDto> {
  const [services, packages] = await Promise.all([
    db.selectFrom('services').select(['id', 'name', 'category', 'price_vnd']).where('active', '=', true).orderBy('name').execute(),
    db.selectFrom('packages').select(['id', 'name', 'unit', 'qty', 'price_vnd', 'validity_days']).where('active', '=', true).orderBy('name').execute(),
  ]);
  return {
    services: services.map((s) => ({ id: s.id, name: s.name, category: s.category, priceVnd: n(s.price_vnd) })),
    packages: packages.map((p) => ({ id: p.id, name: p.name, unit: p.unit, qty: p.qty, priceVnd: n(p.price_vnd), validityDays: p.validity_days })),
  };
}

async function requirePatient(patientId: string): Promise<void> {
  const p = await db.selectFrom('patients').select('id').where('id', '=', patientId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!p) throw new NotFoundError('Bệnh nhân');
}

export async function createOrder(input: CreateOrderInput, actor: Actor, meta: RequestMeta): Promise<OrderDto> {
  await requirePatient(input.patientId);
  const branch = await db.selectFrom('branches').select('id').where('is_default', '=', true).executeTakeFirst();
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto('orders')
      .values({
        patient_id: input.patientId,
        branch_id: input.branchId ?? branch?.id ?? null,
        note: input.note ?? null,
        created_by: actor.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await writeAuditLog(trx, {
      requestId: meta.requestId, actorId: actor.id, actorEmail: actor.email,
      action: 'ORDER_CREATE', entityType: 'order', entityId: row.id, ipAddress: meta.ipAddress,
    });
    return loadOrder(trx, row.id);
  });
}

export async function addLine(orderId: string, input: AddLineInput, actor: Actor, meta: RequestMeta): Promise<OrderDto> {
  return db.transaction().execute(async (trx) => {
    const order = await lockOrder(trx, orderId);
    if (order.status === 'cancelled' || order.status === 'paid') {
      throw new ConflictError('Đơn đã chốt/huỷ, không thể thêm dòng');
    }

    let kind = 'other', name = input.name ?? '', unitPrice = input.unitPriceVnd ?? 0, refId: string | null = null;
    if (input.serviceId) {
      const s = await trx.selectFrom('services').select(['name', 'price_vnd']).where('id', '=', input.serviceId).where('active', '=', true).executeTakeFirst();
      if (!s) throw new NotFoundError('Dịch vụ');
      kind = 'service'; name = s.name; unitPrice = n(s.price_vnd); refId = input.serviceId;
    } else if (input.packageId) {
      const p = await trx.selectFrom('packages').select(['name', 'price_vnd']).where('id', '=', input.packageId).where('active', '=', true).executeTakeFirst();
      if (!p) throw new NotFoundError('Gói');
      kind = 'package'; name = p.name; unitPrice = n(p.price_vnd); refId = input.packageId;
    }
    const amount = input.qty * unitPrice - input.discountVnd;
    if (amount < 0) throw new ValidationError('Giảm giá vượt quá thành tiền');

    await trx.insertInto('order_lines').values({
      order_id: orderId, kind, ref_id: refId, name, qty: input.qty,
      unit_price_vnd: unitPrice, discount_vnd: input.discountVnd, amount_vnd: amount,
    }).execute();

    await recompute(trx, orderId);
    await writeAuditLog(trx, {
      requestId: meta.requestId, actorId: actor.id, actorEmail: actor.email,
      action: 'ORDER_LINE_ADD', entityType: 'order', entityId: orderId, reason: name, ipAddress: meta.ipAddress,
    });
    return loadOrder(trx, orderId);
  });
}

export async function removeLine(orderId: string, lineId: string, actor: Actor, meta: RequestMeta): Promise<OrderDto> {
  return db.transaction().execute(async (trx) => {
    const order = await lockOrder(trx, orderId);
    if (order.status === 'paid' || order.status === 'cancelled') throw new ConflictError('Đơn đã chốt/huỷ');
    const del = await trx.deleteFrom('order_lines').where('id', '=', lineId).where('order_id', '=', orderId).executeTakeFirst();
    if (!del.numDeletedRows) throw new NotFoundError('Dòng đơn');
    await recompute(trx, orderId);
    await writeAuditLog(trx, {
      requestId: meta.requestId, actorId: actor.id, actorEmail: actor.email,
      action: 'ORDER_LINE_REMOVE', entityType: 'order', entityId: orderId, ipAddress: meta.ipAddress,
    });
    return loadOrder(trx, orderId);
  });
}

export async function takePayment(orderId: string, input: TakePaymentInput, actor: Actor, meta: RequestMeta): Promise<OrderDto> {
  return db.transaction().execute(async (trx) => {
    const order = await lockOrder(trx, orderId);
    if (order.status === 'cancelled') throw new ConflictError('Đơn đã huỷ');
    const total = n(order.total_vnd);
    if (total <= 0) throw new ValidationError('Đơn chưa có dòng nào để thu');
    const paid = n((await trx.selectFrom('payments').select((eb) => eb.fn.sum<string>('amount_vnd').as('s')).where('order_id', '=', orderId).executeTakeFirst())?.s);
    const remaining = total - paid;
    if (input.amountVnd > remaining) throw new ValidationError(`Số tiền vượt quá còn lại (${remaining.toLocaleString('vi-VN')} ₫)`);

    await trx.insertInto('payments').values({
      order_id: orderId, method: input.method, amount_vnd: input.amountVnd, received_by: actor.id,
    }).execute();

    const becamePaid = paid + input.amountVnd >= total;
    await recompute(trx, orderId);
    if (becamePaid) await materializePackages(trx, orderId, order.patient_id);

    await writeAuditLog(trx, {
      requestId: meta.requestId, actorId: actor.id, actorEmail: actor.email,
      action: 'PAYMENT_TAKE', entityType: 'order', entityId: orderId,
      reason: `${input.amountVnd} ${input.method}`, ipAddress: meta.ipAddress,
    });
    await writePhiAccessLog(trx, {
      requestId: meta.requestId, patientId: order.patient_id, accessedBy: actor.id,
      accessType: 'modify', fieldsAccessed: ['payment'], ipAddress: meta.ipAddress,
    });
    return loadOrder(trx, orderId);
  });
}

export async function cancelOrder(orderId: string, actor: Actor, meta: RequestMeta): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const order = await lockOrder(trx, orderId);
    const paid = n((await trx.selectFrom('payments').select((eb) => eb.fn.sum<string>('amount_vnd').as('s')).where('order_id', '=', orderId).executeTakeFirst())?.s);
    if (paid > 0) throw new ConflictError('Đơn đã thu tiền — cần hoàn tiền trước khi huỷ');
    await trx.updateTable('orders').set({ status: 'cancelled', updated_at: new Date() }).where('id', '=', orderId).execute();
    await writeAuditLog(trx, {
      requestId: meta.requestId, actorId: actor.id, actorEmail: actor.email,
      action: 'ORDER_CANCEL', entityType: 'order', entityId: orderId, ipAddress: meta.ipAddress,
    });
  });
}

export async function getOrder(orderId: string): Promise<OrderDto> {
  return loadOrder(db, orderId);
}

export async function listByPatient(patientId: string): Promise<OrderDto[]> {
  const rows = await db.selectFrom('orders').select(['id']).where('patient_id', '=', patientId).orderBy('created_at', 'desc').execute();
  return Promise.all(rows.map((r) => loadOrder(db, r.id)));
}

/** Sổ thanh toán (S18) — lọc theo trạng thái / mã đơn / MRN. */
export async function listOrders(q: ListOrdersQuery): Promise<Omit<OrderDto, 'lines' | 'payments'>[]> {
  let query = db
    .selectFrom('orders as o')
    .innerJoin('patients as p', 'p.id', 'o.patient_id')
    .select(['o.id', 'o.code', 'o.patient_id', 'p.mrn', 'o.status', 'o.total_vnd', 'o.note', 'o.created_at']);
  if (q.status) query = query.where('o.status', '=', q.status);
  if (q.q) query = query.where((eb) => eb.or([eb('o.code', 'ilike', `%${q.q}%`), eb('p.mrn', 'ilike', `%${q.q}%`)]));
  const rows = await query.orderBy('o.created_at', 'desc').limit(200).execute();

  const paidMap = await paidByOrder(rows.map((r) => r.id));
  return rows.map((r) => {
    const total = n(r.total_vnd), paid = paidMap.get(r.id) ?? 0;
    return {
      id: r.id, code: r.code, patientId: r.patient_id, patientMrn: r.mrn, status: r.status,
      totalVnd: total, paidVnd: paid, remainingVnd: total - paid, note: r.note,
      createdAt: new Date(r.created_at).toISOString(),
    };
  });
}

/** Công nợ (S19) — đơn chưa thu đủ. */
export async function receivables(): Promise<{ total: number; count: number; items: Omit<OrderDto, 'lines' | 'payments'>[] }> {
  const items = (await listOrders({ status: undefined })).filter((o) => o.status === 'unpaid' || o.status === 'partial');
  return { total: items.reduce((s, o) => s + o.remainingVnd, 0), count: items.length, items };
}

// ── nội bộ ──
async function lockOrder(trx: Transaction<Database>, orderId: string) {
  const o = await trx.selectFrom('orders').selectAll().where('id', '=', orderId).forUpdate().executeTakeFirst();
  if (!o) throw new NotFoundError('Đơn');
  return o;
}

async function recompute(trx: Transaction<Database>, orderId: string): Promise<void> {
  const cur = await trx.selectFrom('orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow();
  if (cur.status === 'cancelled') return;
  const total = n((await trx.selectFrom('order_lines').select((eb) => eb.fn.sum<string>('amount_vnd').as('s')).where('order_id', '=', orderId).executeTakeFirst())?.s);
  const paid = n((await trx.selectFrom('payments').select((eb) => eb.fn.sum<string>('amount_vnd').as('s')).where('order_id', '=', orderId).executeTakeFirst())?.s);
  const status = total === 0 ? 'draft' : paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  await trx.updateTable('orders').set({ total_vnd: total, status, updated_at: new Date() }).where('id', '=', orderId).execute();
}

async function materializePackages(trx: Transaction<Database>, orderId: string, patientId: string): Promise<void> {
  const lines = await trx.selectFrom('order_lines').select(['ref_id', 'name', 'qty']).where('order_id', '=', orderId).where('kind', '=', 'package').execute();
  for (const line of lines) {
    if (!line.ref_id) continue;
    const exists = await trx.selectFrom('customer_packages').select('id').where('order_id', '=', orderId).where('package_id', '=', line.ref_id).executeTakeFirst();
    if (exists) continue;
    const pkg = await trx.selectFrom('packages').select(['qty', 'validity_days']).where('id', '=', line.ref_id).executeTakeFirst();
    if (!pkg) continue;
    const expires = pkg.validity_days ? new Date(Date.now() + pkg.validity_days * 86_400_000) : null;
    await trx.insertInto('customer_packages').values({
      patient_id: patientId, package_id: line.ref_id, order_id: orderId,
      name: line.name, total: line.qty * pkg.qty, expires_at: expires,
    }).execute();
  }
}

async function paidByOrder(orderIds: string[]): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db.selectFrom('payments').select(['order_id', (eb) => eb.fn.sum<string>('amount_vnd').as('s')]).where('order_id', 'in', orderIds).groupBy('order_id').execute();
  return new Map(rows.map((r) => [r.order_id, n(r.s)]));
}

async function loadOrder(ex: Db, orderId: string): Promise<OrderDto> {
  const o = await ex.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirst();
  if (!o) throw new NotFoundError('Đơn');
  const [lines, payments] = await Promise.all([
    ex.selectFrom('order_lines').selectAll().where('order_id', '=', orderId).orderBy('created_at').execute(),
    ex.selectFrom('payments').selectAll().where('order_id', '=', orderId).orderBy('paid_at').execute(),
  ]);
  const total = n(o.total_vnd);
  const paid = payments.reduce((s, p) => s + n(p.amount_vnd), 0);
  return {
    id: o.id, code: o.code, patientId: o.patient_id, status: o.status,
    totalVnd: total, paidVnd: paid, remainingVnd: total - paid, note: o.note,
    createdAt: new Date(o.created_at).toISOString(),
    lines: lines.map((l) => ({ id: l.id, kind: l.kind, name: l.name, qty: l.qty, unitPriceVnd: n(l.unit_price_vnd), discountVnd: n(l.discount_vnd), amountVnd: n(l.amount_vnd) })),
    payments: payments.map((p) => ({ id: p.id, method: p.method, amountVnd: n(p.amount_vnd), paidAt: new Date(p.paid_at).toISOString() })),
  };
}
