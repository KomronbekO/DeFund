import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  backendUrl: process.env.BACKEND_URL ?? 'http://127.0.0.1:4001',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX ?? '60', 10),
  requireAuthOnUploads: process.env.REQUIRE_AUTH_ON_UPLOADS === 'true',
};
