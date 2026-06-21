/**
 * GET /health
 * Lightweight liveness probe. Used by the GitHub Actions keep-alive workflow to
 * stop Render's free tier from spinning the service down.
 */
export default async function healthRoutes(fastify) {
  fastify.get('/health', async () => ({ status: 'alive' }));
}
