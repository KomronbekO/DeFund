import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { campaignsRouter } from './routes/campaigns';
import { uploadsRouter } from './routes/uploads';
import { LOCAL_UPLOADS_DIR } from './lib/storage';
import { logger } from './logger';

export function createApp(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'backend', uptime: process.uptime() });
  });

  app.use('/campaigns', campaignsRouter);
  app.use('/uploads', uploadsRouter);
  // Local-dev fallback: serve files written by the disk-storage upload path.
  app.use('/files', express.static(LOCAL_UPLOADS_DIR, { fallthrough: false, maxAge: '1h' }));

  app.use((req, res) => {
    res.status(404).json({ error: `not found: ${req.method} ${req.path}` });
  });

  return app;
}
