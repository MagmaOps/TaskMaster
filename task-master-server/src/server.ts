import { createApp } from './app';
import { config } from './config';
import { validateEnv } from './config/validateEnv';
import { checkConnection, closePool } from './database/pool';

/** Server bootstrap: validate config, verify DB, start listening, shut down cleanly. */
async function start(): Promise<void> {
  validateEnv();

  const app = createApp();

  const dbHealthy = await checkConnection();
  if (!dbHealthy) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  Database not reachable at startup — the server will start but /health will report degraded.');
  }

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`🚀 TaskMaster API listening on :${config.port} (${config.env})`);
  });

  const shutdown = (signal: string): void => {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} received — shutting down...`);
    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
