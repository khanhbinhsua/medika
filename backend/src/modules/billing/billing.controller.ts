import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './billing.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import { createOrderSchema, addLineSchema, takePaymentSchema, listOrdersSchema } from './billing.schemas.js';

const idParam = z.object({ id: z.string().uuid('Mã đơn không hợp lệ') });
const lineParam = z.object({ id: z.string().uuid(), lineId: z.string().uuid('Mã dòng không hợp lệ') });
const patientParam = z.object({ patientId: z.string().uuid('Mã bệnh nhân không hợp lệ') });

function actor(req: Request): Actor { return { id: req.user!.sub, email: req.user!.email }; }
function meta(req: Request): RequestMeta { return { requestId: req.requestId, ipAddress: req.ip }; }
function noStore(res: Response) { res.setHeader('Cache-Control', 'no-store'); }

export async function catalog(_req: Request, res: Response) {
  res.json(await service.getCatalog());
}
export async function createOrder(req: Request, res: Response) {
  const input = createOrderSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.createOrder(input, actor(req), meta(req)));
}
export async function listOrders(req: Request, res: Response) {
  const q = listOrdersSchema.parse(req.query);
  noStore(res);
  res.json(await service.listOrders(q));
}
export async function receivables(_req: Request, res: Response) {
  noStore(res);
  res.json(await service.receivables());
}
export async function getOrder(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.getOrder(id));
}
export async function addLine(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const input = addLineSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.addLine(id, input, actor(req), meta(req)));
}
export async function removeLine(req: Request, res: Response) {
  const { id, lineId } = lineParam.parse(req.params);
  noStore(res);
  res.json(await service.removeLine(id, lineId, actor(req), meta(req)));
}
export async function takePayment(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const input = takePaymentSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.takePayment(id, input, actor(req), meta(req)));
}
export async function cancelOrder(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  await service.cancelOrder(id, actor(req), meta(req));
  res.status(204).end();
}
export async function patientOrders(req: Request, res: Response) {
  const { patientId } = patientParam.parse(req.params);
  noStore(res);
  res.json(await service.listByPatient(patientId));
}
