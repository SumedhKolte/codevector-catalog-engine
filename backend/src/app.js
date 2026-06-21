import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';

import { config } from './config.js';
import { InvalidCursorError } from './lib/cursor.js';

import healthRoutes from './routes/health.js';
import productsRoutes from './routes/products.js';
import simulateRoutes from './routes/simulate.js';
import benchmarkRoutes from './routes/benchmark.js';

/**
 * Build (but do not start) the Fastify instance. Exported so tests can spin up
 * the app with `app.inject` / supertest without binding a port.
 */
export async function buildApp(overrides = {}) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Pretty logs in dev; structured JSON (Pino default) in production.
      transport:
        config.isProd || overrides.silent
          ? undefined
          : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    },
    ...(overrides.silent ? { logger: false } : {}),
  });

  await app.register(cors, { origin: corsOriginOption(config.corsOrigin) });

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    // Health checks must never be rate limited (keep-alive pings hit it often).
    allowList: (req) => req.url === '/health',
  });

  // Translate known domain errors into clean HTTP responses.
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof InvalidCursorError) {
      return reply.code(400).send({ error: 'invalid_cursor', message: err.message });
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Too many requests' });
    }
    request.log.error({ err }, 'unhandled error');
    return reply.code(err.statusCode ?? 500).send({
      error: 'internal_error',
      message: config.isProd ? 'Something went wrong' : err.message,
    });
  });

  // (CORS matcher helper is defined at module scope below.)

  await app.register(healthRoutes);
  await app.register(productsRoutes);
  await app.register(simulateRoutes);
  await app.register(benchmarkRoutes);

  return app;
}

/**
 * Build the value passed to @fastify/cors `origin`.
 *  - '*'            -> reflect any origin (dev / open demo)
 *  - string[]       -> a function that allows exact matches (trailing slash
 *                      tolerant) plus `*.domain` wildcard entries.
 * Requests with no Origin header (curl, health checks, same-origin) are allowed.
 */
function corsOriginOption(allowed) {
  if (allowed === '*') return true;

  return (origin, cb) => {
    if (!origin) return cb(null, true);
    const normalized = origin.replace(/\/+$/, '');

    const ok = allowed.some((entry) => {
      if (entry.startsWith('*.')) {
        const suffix = entry.slice(1); // "*.vercel.app" -> ".vercel.app"
        try {
          return new URL(normalized).hostname.endsWith(suffix);
        } catch {
          return false;
        }
      }
      return normalized === entry;
    });

    cb(ok ? null : new Error(`Origin not allowed by CORS: ${origin}`), ok);
  };
}
