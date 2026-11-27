// Browser reads and signed provider deliveries share the public inbox service.
import express from 'express';
import type { PublicPriorityInbox } from '../application/PublicPriorityInbox.js';
import type { PortalApi } from '../application/PortalApi.js';

export function createPublicInboxApi(inbox: PublicPriorityInbox, portal?: PortalApi) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.RENDER === 'true') app.set('trust proxy', 1);
  if (portal) app.use(portal.endpointStats.track());
  app.use(['/v1/health', '/v1/priority', '/v1/inbound'], (_request, response, next) => {
    response.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    next();
  });
  // The listener starts after the migration. Frequent Render health checks need no database query.
  app.get('/v1/health', (_request, response) => response.json({ status: 'ok', storage: 'postgresql' }));
  app.get('/v1/priority', async (request, response) => {
    try { response.json(await inbox.snapshot(request.query.include === 'routine')); }
    catch { response.sendStatus(503); }
  });
  app.post('/v1/inbound', express.raw({ type: 'application/json', limit: '256kb', inflate: false }), async (request, response) => {
    if (!inbox.receiving) { response.sendStatus(503); return; }
    if (!Buffer.isBuffer(request.body)) { response.sendStatus(415); return; }
    const event = inbox.receiving.verify(request.body, {
      id: request.get('svix-id') ?? '',
      timestamp: request.get('svix-timestamp') ?? '',
      signature: request.get('svix-signature') ?? '',
    });
    if (event.delivery) {
      // Resend retries on 503. Acknowledge only after the durable insert (or deduplication).
      try { await inbox.acceptDelivery(event.delivery.id, event.delivery.receivedAt); }
      catch { response.sendStatus(503); return; }
    }
    response.sendStatus(event.status);
  });
  if (portal) app.use('/v1', portal.router);
  return app;
}
