// The demo exposes the curated inbox without sessions, account data, or a public inference trigger.
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
  return app;
}
