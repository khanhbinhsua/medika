import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './appointment.service.js';
import type { Actor, RequestMeta } from '../patient/patient.service.js';
import {
  createAppointmentSchema,
  updateAppointmentSchema,
  listAppointmentsSchema,
  appointmentCountsSchema,
  transitionSchema,
  cancelAppointmentSchema,
} from './appointment.schemas.js';

const idParam = z.object({ appointmentId: z.string().uuid('Mã lịch hẹn không hợp lệ') });

function actor(req: Request): Actor {
  return { id: req.user!.sub, email: req.user!.email };
}

function meta(req: Request): RequestMeta {
  return { requestId: req.requestId, ipAddress: req.ip };
}

function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
}

export async function create(req: Request, res: Response) {
  const input = createAppointmentSchema.parse(req.body);
  const appointment = await service.createAppointment(input, actor(req), meta(req));
  noStore(res);
  res.status(201).json(appointment);
}

export async function list(req: Request, res: Response) {
  const query = listAppointmentsSchema.parse(req.query);
  noStore(res);
  res.json(await service.listAppointments(query, actor(req), meta(req)));
}

export async function counts(req: Request, res: Response) {
  const query = appointmentCountsSchema.parse(req.query);
  noStore(res);
  res.json(await service.countsByStatus(query));
}

export async function getById(req: Request, res: Response) {
  const { appointmentId } = idParam.parse(req.params);
  noStore(res);
  res.json(await service.getAppointment(appointmentId, actor(req), meta(req)));
}

export async function update(req: Request, res: Response) {
  const { appointmentId } = idParam.parse(req.params);
  const input = updateAppointmentSchema.parse(req.body);
  noStore(res);
  res.json(await service.updateAppointment(appointmentId, input, actor(req), meta(req)));
}

export async function changeStatus(req: Request, res: Response) {
  const { appointmentId } = idParam.parse(req.params);
  const { status } = transitionSchema.parse(req.body);
  noStore(res);
  res.json(await service.transition(appointmentId, status, actor(req), meta(req)));
}

export async function cancel(req: Request, res: Response) {
  const { appointmentId } = idParam.parse(req.params);
  const { reason } = cancelAppointmentSchema.parse(req.body);
  noStore(res);
  res.json(await service.cancelAppointment(appointmentId, reason, actor(req), meta(req)));
}
