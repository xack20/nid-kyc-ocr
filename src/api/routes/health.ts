import { Router } from 'express';
import { config } from '../../config/index.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    model:  config.gemini.model,
    time:   new Date().toISOString(),
  });
});
