// Entry point: build the app and bind the HTTP port.
import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db.js';

const app = await buildApp();

// Safety net: log unexpected async errors instead of letting them take the
// process down. The real fix for the pool case lives in db.js (pool 'error'
// handler); this catches anything else that slips through during a burst.
process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'unhandledRejection (kept alive)');
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown so in-flight requests and the pg pool close cleanly.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await closePool();
    process.exit(0);
  });
}
