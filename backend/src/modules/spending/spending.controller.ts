import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './spending.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import {
  createTransactionSchema,
  updateTransactionSchema,
  listTransactionsSchema,
  topSpendersSchema,
  importSchema,
} from './spending.schemas.js';

const patientParam = z.object({ patientId: z.string().uuid('Mã bệnh nhân không hợp lệ') });
const txnParam = z.object({ id: z.string().uuid('Mã khoản chi không hợp lệ') });

function actor(req: Request): Actor {
  return { id: req.user!.sub, email: req.user!.email };
}
function meta(req: Request): RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip };
}
function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
}

export async function tiers(_req: Request, res: Response) {
  res.json(await service.getTiers());
}

export async function summary(req: Request, res: Response) {
  const { patientId } = patientParam.parse(req.params);
  noStore(res);
  res.json(await service.patientSummary(patientId, actor(req), meta(req)));
}

export async function list(req: Request, res: Response) {
  const { patientId } = patientParam.parse(req.params);
  const q = listTransactionsSchema.parse(req.query);
  noStore(res);
  res.json(await service.listTransactions(patientId, q, actor(req), meta(req)));
}

export async function add(req: Request, res: Response) {
  const { patientId } = patientParam.parse(req.params);
  const input = createTransactionSchema.parse(req.body);
  noStore(res);
  res.status(201).json(await service.addTransaction(patientId, input, actor(req), meta(req)));
}

export async function update(req: Request, res: Response) {
  const { id } = txnParam.parse(req.params);
  const input = updateTransactionSchema.parse(req.body);
  noStore(res);
  res.json(await service.updateTransaction(id, input, actor(req), meta(req)));
}

export async function remove(req: Request, res: Response) {
  const { id } = txnParam.parse(req.params);
  await service.deleteTransaction(id, actor(req), meta(req));
  res.status(204).end();
}

export async function top(req: Request, res: Response) {
  const q = topSpendersSchema.parse(req.query);
  noStore(res);
  res.json(await service.topSpenders(q, actor(req), meta(req)));
}

export async function importRows(req: Request, res: Response) {
  const input = importSchema.parse(req.body);
  noStore(res);
  res.json(await service.importTransactions(input, actor(req), meta(req)));
}
