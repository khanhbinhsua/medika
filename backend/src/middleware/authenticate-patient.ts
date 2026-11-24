import type { RequestHandler } from 'express';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { verifyPortalAccessToken } from '../modules/portal/portal.token.service.js';
import { UnauthorizedError, ForbiddenError } from './errors.js';

export interface PatientContext {
  portalAccountId: string;
  patientId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      patient?: PatientContext;
    }
  }
}

/**
 * Xác thực bệnh nhân trên cổng self-service. Kiểm tra JWT audience 'crm-dk-portal'
 * (token nhân viên sẽ trượt), phiên còn sống, tài khoản active, và cưỡng chế
 * idle timeout. Gắn req.patient — MỌI truy vấn dữ liệu ở cổng phải giới hạn
 * theo req.patient.patientId, không có ngoại lệ.
 */
export const authenticatePatient: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Thiếu access token');

      const payload = verifyPortalAccessToken(header.slice(7));

      const account = await db
        .selectFrom('patient_portal_accounts')
        .select(['id', 'patient_id', 'status'])
        .where('id', '=', payload.sub)
        .executeTakeFirst();

      if (!account || account.status !== 'active') {
        throw new ForbiddenError('Tài khoản cổng bệnh nhân đã bị vô hiệu hoá');
      }
      // Token mang patientId — phải khớp tài khoản, phòng token bị chỉnh sửa.
      if (account.patient_id !== payload.patientId) {
        throw new UnauthorizedError('Token không hợp lệ');
      }

      req.patient = { portalAccountId: account.id, patientId: account.patient_id };
      next();
    } catch (err) {
      if (err instanceof ForbiddenError) next(err);
      else next(err instanceof UnauthorizedError ? err : new UnauthorizedError('Access token không hợp lệ'));
    }
  })();
};

// Idle timeout dùng chung cấu hình với nhân viên.
export const PORTAL_IDLE_TIMEOUT_SECONDS = env.SESSION_IDLE_TIMEOUT_SECONDS;
