// Centralised, validated configuration. Loaded once at process start.
import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  // Hosted Postgres (Supabase, Neon, Render) terminates TLS. Default to on.
  dbSsl: (process.env.PGSSL ?? 'true') !== 'false',

  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',

  // CORS: '*' for local dev, or a comma-separated allowlist in production.
  corsOrigin:
    (process.env.CORS_ORIGIN ?? '*') === '*'
      ? '*'
      : (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()),

  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 100),
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',

  seedCount: Number(process.env.SEED_COUNT ?? 200000),
  seedBatchSize: Number(process.env.SEED_BATCH_SIZE ?? 10000),

  logLevel: process.env.LOG_LEVEL ?? 'info',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
};
