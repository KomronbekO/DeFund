import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { config } from './config';
import { logger } from './logger';
import { siweAuth } from './middleware/siweAuth';

export interface AppOptions {
  backendUrl?: string;
}

export function createApp(opts: AppOptions = {}): express.Express {
  const app = express();
  const upstream = opts.backendUrl ?? config.backendUrl;

  app.use(pinoHttp({ logger }));
  app.use(cors({ origin: config.frontendOrigin }));

  app.use(
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.rateLimitMax,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'gateway', upstream });
  });

  // Auth required only on /uploads (mutation endpoint)
  app.use('/uploads', siweAuth);

  // Forward everything to backend
  app.use(
    '/',
    createProxyMiddleware({
      target: upstream,
      changeOrigin: true,
      logger,
    }),
  );

  return app;
}
