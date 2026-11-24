import type { RequestHandler } from 'express';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { writeAuditLog } from '../audit/audit-logger.js';
import { verifyAccessToken } from '../modules/auth/token.service.js';
import { UnauthorizedError, ForbiddenError } from './errors.js';

/**
 * Verify JWT, kiểm tra session còn sống, và cưỡng chế idle timeout 30 phút
 * (HIPAA §164.312(a)(2)(iii) Automatic logoff).
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        throw new UnauthorizedError('Thiếu access token');
      }

      const payload = verifyAccessToken(header.slice(7));

      const session = await db
        .selectFrom('sessions')
        .select(['id', 'revoked_at', 'expires_at', 'last_activity_at'])
        .where('id', '=', payload.sessionId)
        .executeTakeFirst();

      if (!session || session.revoked_at) {
        throw new UnauthorizedError('Phiên đăng nhập đã kết thúc');
      }

      const now = Date.now();
      if (session.expires_at.getTime() < now) {
        throw new UnauthorizedError('Phiên đăng nhập đã hết hạn');
      }

      const idleMs = now - session.last_activity_at.getTime();
      if (idleMs > env.SESSION_IDLE_TIMEOUT_SECONDS * 1000) {
        await db
          .updateTable('sessions')
          .set({ revoked_at: new Date(), revoked_reason: 'idle_timeout' })
          .where('id', '=', session.id)
          .execute();
        throw new UnauthorizedError('Phiên đăng nhập hết hạn do không hoạt động');
      }

      await db
        .updateTable('sessions')
        .set({ last_activity_at: new Date() })
        .where('id', '=', session.id)
        .execute();

      req.user = payload;
      next();
    } catch (err) {
      next(err instanceof UnauthorizedError ? err : new UnauthorizedError('Access token không hợp lệ'));
    }
  })();
};

/**
 * RBAC. Mọi lần TỪ CHỐI đều được ghi audit — HIPAA §164.308(a)(1)(ii)(D) yêu cầu
 * rà soát hoạt động hệ thống, và các lần truy cập bị chặn chính là tín hiệu sớm
 * của tài khoản bị chiếm quyền hoặc nhân viên dò dữ liệu.
 */
export function authorize(...requiredPermissions: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }

    const granted = new Set(req.user.permissions);
    const missing = requiredPermissions.filter((p) => !granted.has(p));

    if (missing.length === 0) {
      next();
      return;
    }

    const user = req.user;
    void db
      .transaction()
      .execute((trx) =>
        writeAuditLog(trx, {
          requestId: req.requestId,
          actorId: user.sub,
          actorEmail: user.email,
          action: 'ACCESS_DENIED',
          entityType: 'endpoint',
          outcome: 'denied',
          reason: `missing_permission:${missing.join(',')} path:${req.method} ${req.path}`,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        }),
      )
      .catch((err: unknown) => logger.error({ err }, 'Không ghi được audit log cho ACCESS_DENIED'));

    next(new ForbiddenError(`Thiếu quyền: ${missing.join(', ')}`));
  };
}
