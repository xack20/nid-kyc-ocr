import express from 'express';
import { extractRouter } from './api/routes/extract.js';
import { healthRouter }  from './api/routes/health.js';
import { docsRouter }    from './api/routes/docs.js';
import { errorHandler }  from './api/middleware/errorHandler.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/extract', extractRouter);
  app.use('/health',  healthRouter);
  app.use('/docs',    docsRouter);

  app.use(errorHandler);
  return app;
}
