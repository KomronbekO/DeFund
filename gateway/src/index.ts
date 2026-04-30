import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, upstream: config.backendUrl }, 'gateway listening');
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
