import 'dotenv/config';
import { createApp } from './server.js';
import { config }    from './config/index.js';

const app = createApp();
app.listen(config.server.port, () => {
  console.log(`KYC OCR service running on http://localhost:${config.server.port}`);
  console.log(`  API docs  → http://localhost:${config.server.port}/docs`);
  console.log(`  Health    → http://localhost:${config.server.port}/health`);
  console.log(`  Model     → ${config.gemini.model}`);
});
