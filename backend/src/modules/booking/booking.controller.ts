import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './booking.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import { slotsQuerySchema, createBookingSchema, confirmBookingSchema, rejectBookingSchema } from './booking.schemas.js';
import { db } from '../../db/index.js';
import { NotFoundError } from '../../middleware/errors.js';

const idParam = z.object({ id: z.string().uuid('Mã yêu cầu không hợp lệ') });

function actor(req: Request): Actor {
  return { id: req.user!.sub, email: req.user!.email };
}
function meta(req: Request): RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip };
}
function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
}

// ── Public (không đăng nhập) ──
export async function publicBranches(_req: Request, res: Response) {
  res.json(await service.listPublicBranches());
}

export async function publicSlots(req: Request, res: Response) {
  const { branchId, date } = slotsQuerySchema.parse(req.query);
  noStore(res);
  res.json(await service.availableSlots(branchId, date));
}

export async function publicCreate(req: Request, res: Response) {
  const input = createBookingSchema.parse(req.body);
  noStore(res);
  const r = await service.createBookingRequest(input);
  res.status(201).json({ id: r.id, status: 'pending' });
}

// ── Nhân sự (booking:manage) ──
export async function pending(_req: Request, res: Response) {
  noStore(res);
  res.json(await service.listPending());
}

export async function matches(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const booking = await db.selectFrom('booking_requests').select('phone').where('id', '=', id).executeTakeFirst();
  if (!booking) throw new NotFoundError('Yêu cầu đặt lịch');
  noStore(res);
  res.json(await service.matchPatientsByPhone(booking.phone, actor(req), meta(req)));
}

export async function confirm(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const input = confirmBookingSchema.parse(req.body);
  noStore(res);
  res.json(await service.confirmBooking(id, input, actor(req), meta(req)));
}

export async function reject(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { reason } = rejectBookingSchema.parse(req.body);
  await service.rejectBooking(id, reason, actor(req), meta(req));
  res.status(204).end();
}
