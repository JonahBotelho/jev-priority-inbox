// Public read-only preview exposes only the approved fictional samples, never mailbox records.
import { Router } from 'express';
import { Fixtures } from '../adapters/Fixtures.js';
import { en } from '../../locales/en.js';
import { MessagePreview } from '../application/MessagePreview.js';

export class DemoPreview {
  readonly router = Router();

  constructor() {
    const receivedAt = Date.now();
    const cards = Fixtures.names.map((name, index) => ({
      id: name,
      tier: Fixtures.expected(name),
      subject: Fixtures.get(name).subject,
      preview: MessagePreview.from(Fixtures.get(name).text),
      receivedAt: new Date(receivedAt - index * 5 * 60000).toISOString(),
    }));

    this.router.get('/demo/inbox', (_request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.json({ cards, processing: { pending: 0, failed: 0 } });
    });
    this.router.get('/demo/messages/:id', (request, response) => {
      const card = cards.find(sample => sample.id === request.params.id);
      if (!card) { response.status(404).json({ error: en.missing }); return; }
      response.setHeader('Cache-Control', 'no-store');
      response.json({ ...Fixtures.get(card.id), from: en.fictionalSender, receivedAt: card.receivedAt });
    });
  }
}
