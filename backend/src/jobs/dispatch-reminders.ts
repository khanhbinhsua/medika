import { dispatchDueReminders } from '../modules/reminder/reminder.service.js';
import { initCrypto } from '../crypto/field-encryption.js';
import { closeDatabase } from '../db/index.js';
import { logger } from '../config/logger.js';

/**
 * Điểm vào cho cron / scheduler: gửi mọi nhắc lịch tới hạn rồi thoát.
 * Production: chạy mỗi 5–15 phút qua cron trên host hoặc EventBridge → ECS task.
 * Dev/thủ công: `npm run reminders:dispatch`.
 */
async function main() {
  await initCrypto();
  const result = await dispatchDueReminders();
  logger.info(result, 'dispatch-reminders hoàn tất');
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, 'dispatch-reminders thất bại');
    await closeDatabase();
    process.exit(1);
  });
