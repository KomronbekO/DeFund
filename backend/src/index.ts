import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';
import { Indexer } from './indexer/listener';
import { prisma } from './db/prisma';

async function main(): Promise<void> {
  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'backend listening');
  });

  // Start indexer in the same process. Failures are non-fatal so REST stays up.
  const indexer = new Indexer(config.rpcUrl);
  indexer.start().catch((err) => {
    logger.error({ err }, 'indexer failed to start');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    indexer.stop();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});
