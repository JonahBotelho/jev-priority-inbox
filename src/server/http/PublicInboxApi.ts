// Browser reads and signed provider deliveries share the public inbox service.
import express from 'express';
import type { PublicPriorityInbox } from '../application/PublicPriorityInbox.js';

export function createPublicInboxApi(inbox: PublicPriorityInbox) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/v1', (_request, response, next) => {
    response.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    next();
  });
  app.get('/v1/health', (_request, response) => response.json({ status: 'ok' }));
  app.get('/v1/priority', (_request, response) => response.json(inbox.snapshot()));
  app.post('/v1/inbound', express.raw({ type: 'application/json', limit: '256kb', inflate: false }), (request, response) => {
    if (!inbox.receiving) { response.sendStatus(503); return; }
    if (!Buffer.isBuffer(request.body)) { response.sendStatus(415); return; }
    const event = inbox.receiving.verify(request.body, {
      id: request.get('svix-id') ?? '',
      timestamp: request.get('svix-timestamp') ?? '',
      signature: request.get('svix-signature') ?? '',
    });
    if (event.delivery) inbox.acceptDelivery(event.delivery.id, event.delivery.receivedAt);
    response.sendStatus(event.status);
  });
  return app;
}
