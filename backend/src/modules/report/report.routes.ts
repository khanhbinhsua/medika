import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { writeAuditLog } from '../../audit/audit-logger.js';
import { db } from '../../db/index.js';
import * as service from './report.service.js';

export const reportRouter: Router = Router();

reportRouter.use(authenticate);

const rangeSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

/** Mặc định: 30 ngày gần nhất nếu không truyền from/to. */
function resolveRange(req: Request): { from: Date; to: Date } {
  const { from, to } = rangeSchema.parse(req.query);
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 86_400_000);
  return { from: fromDate, to: toDate };
}

function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
}

reportRouter.get(
  '/overview',
  authorize('report:read'),
  asyncHandler(async (_req, res) => {
    noStore(res);
    res.json(await service.overview());
  }),
);

reportRouter.get(
  '/appointments/by-status',
  authorize('report:read'),
  asyncHandler(async (req, res) => {
    const { from, to } = resolveRange(req);
    noStore(res);
    res.json(await service.appointmentsByStatus(from, to));
  }),
);

reportRouter.get(
  '/appointments/timeline',
  authorize('report:read'),
  asyncHandler(async (req, res) => {
    const { from, to } = resolveRange(req);
    noStore(res);
    res.json(await service.appointmentsTimeline(from, to));
  }),
);

reportRouter.get(
  '/provider-productivity',
  authorize('report:read'),
  asyncHandler(async (req, res) => {
    const { from, to } = resolveRange(req);
    noStore(res);
    res.json(await service.providerProductivity(from, to));
  }),
);

// ── Xuất file (Excel-compatible CSV) — quyền riêng report:export ──────

async function sendCsv(req: Request, res: Response, filename: string, csv: string, reportName: string) {
  await db.transaction().execute((trx) =>
    writeAuditLog(trx, {
      requestId: req.requestId,
      actorId: req.user!.sub,
      actorEmail: req.user!.email,
      action: 'REPORT_EXPORT',
      reason: reportName,
      ipAddress: req.ip,
    }),
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}

reportRouter.get(
  '/export/provider-productivity.csv',
  authorize('report:export'),
  asyncHandler(async (req, res) => {
    const { from, to } = resolveRange(req);
    const csv = await service.exportProviderProductivityCsv(from, to);
    await sendCsv(req, res, 'nang-suat-bac-si.csv', csv, 'provider_productivity');
  }),
);

reportRouter.get(
  '/export/appointments-timeline.csv',
  authorize('report:export'),
  asyncHandler(async (req, res) => {
    const { from, to } = resolveRange(req);
    const csv = await service.exportAppointmentsTimelineCsv(from, to);
    await sendCsv(req, res, 'lich-hen-theo-ngay.csv', csv, 'appointments_timeline');
  }),
);
