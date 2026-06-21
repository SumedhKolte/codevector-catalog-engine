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

// '*' (allow all) or a normalised array of allowed origins. Trailing slashes are
// stripped so a value like "https://app.vercel.app/" still matches the browser's
// slash-less Origin header. Wildcard entries (`*.vercel.app`) are kept as-is and
// matched by host suffix in app.js.
function parseCorsOrigin(raw) {
  const val = (raw ?? '*').trim();
  if (val === '' || val === '*') return '*';
  return val
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  // Hosted Postgres (Supabase, Neon, Render) terminates TLS. Default to on.
  dbSsl: (process.env.PGSSL ?? 'true') !== 'false',

  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',

  // CORS: '*' for local dev, or a comma-separated allowlist in production.
  // Entries are normalised (trailing slashes stripped). A wildcard entry like
  // `*.vercel.app` matches any subdomain (handy for Vercel preview deploys).
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),

  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 100),
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',

  seedCount: Number(process.env.SEED_COUNT ?? 200000),
  seedBatchSize: Number(process.env.SEED_BATCH_SIZE ?? 10000),

  logLevel: process.env.LOG_LEVEL ?? 'info',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
};
