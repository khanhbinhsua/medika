import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { env, corsOrigins, isProduction } from './config/env.js';
import { logger, requestSerializer } from './config/logger.js';
import { requestContext } from './middleware/request-context.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { patientRouter } from './modules/patient/patient.routes.js';
import { appointmentRouter } from './modules/appointment/appointment.routes.js';
import { prescriptionRouter } from './modules/record/record.routes.js';
import { userRouter } from './modules/user/user.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { consentRouter } from './modules/consent/consent.routes.js';
import { documentRouter } from './modules/document/document.routes.js';
import { reminderRouter } from './modules/reminder/reminder.routes.js';
import { reportRouter } from './modules/report/report.routes.js';
import { portalRouter } from './modules/portal/portal.routes.js';
import { notificationRouter, notificationWebhookRouter } from './modules/notification/notification.routes.js';
import { treatmentRouter } from './modules/treatment/treatment.routes.js';
import { marketingRouter } from './modules/marketing/marketing.routes.js';
import { surveyRouter, surveyPublicRouter } from './modules/survey/survey.routes.js';
import { spendingRouter } from './modules/spending/spending.routes.js';
import { conditionsRouter } from './modules/conditions/conditions.routes.js';
import { icd10Router } from './modules/icd10/icd10.routes.js';
import { branchRouter } from './modules/branch/branch.routes.js';
import { dklinkWebhookRouter } from './modules/dklink/dklink.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(
    pinoHttp({
      logger,
      // pino-http dùng serializer mặc định của riêng nó, không tự kế thừa từ
      // logger cha — phải truyền tường minh, nếu không query string (có thể
      // chứa tên/sđt/email bệnh nhân từ ô tìm kiếm) sẽ lọt vào access log.
      serializers: { req: requestSerializer },
      customProps: (req) => ({ requestId: (req as express.Request).requestId }),
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Quá nhiều yêu cầu' } },
    }),
  );

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/patients', patientRouter);
  app.use('/api/appointments', appointmentRouter);
  app.use('/api/prescriptions', prescriptionRouter);
  app.use('/api/users', userRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/consents', consentRouter);
  app.use('/api/documents', documentRouter);
  app.use('/api/reminders', reminderRouter);
  app.use('/api/reports', reportRouter);
  app.use('/api/portal', portalRouter);
  // Webhook (public, bảo vệ bằng secret) PHẢI đứng trước router staff, nếu không
  // middleware authenticate của notificationRouter sẽ nuốt luôn /webhook/*.
  app.use('/api/notifications/webhook', notificationWebhookRouter);
  app.use('/api/notifications', notificationRouter);
  // Webhook nhận bệnh nhân mới từ DK-link (public, bảo vệ bằng Bearer secret).
  app.use('/api/dklink/webhook', dklinkWebhookRouter);
  app.use('/api/treatment-plans', treatmentRouter);
  app.use('/api/marketing', marketingRouter);
  // Trả lời khảo sát công khai (không đăng nhập) — mount trước router staff.
  app.use('/api/public/surveys', surveyPublicRouter);
  app.use('/api/surveys', surveyRouter);
  app.use('/api/spending', spendingRouter);
  app.use('/api/conditions', conditionsRouter);
  app.use('/api/icd10', icd10Router);
  app.use('/api/branches', branchRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
