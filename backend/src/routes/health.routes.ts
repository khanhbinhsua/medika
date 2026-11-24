import { Router } from 'express';
import { checkDatabaseConnection } from '../db/index.js';

export const healthRouter: Router = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

healthRouter.get('/ready', (_req, res, next) => {
  void (async () => {
    try {
      await checkDatabaseConnection();
      res.json({ status: 'ready', database: 'connected' });
    } catch (err) {
      next(err);
    }
  })();
});
