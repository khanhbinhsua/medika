import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { initCrypto } from './crypto/field-encryption.js';
import { checkDatabaseConnection, closeDatabase } from './db/index.js';

async function main() {
  await initCrypto();
  await checkDatabaseConnection();
  logger.info('Kết nối PostgreSQL thành công');

  const server = createApp().listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API đang chạy');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Đang tắt server');
    server.close(() => {
      void closeDatabase().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Không khởi động được server');
  process.exit(1);
});
