// The relay returns Jev's probabilities immediately. Signed receipts allow safe, independent history writes.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { en } from '../../locales/en.js';
import { portalText as labels } from '../../locales/portal.js';
import { readClassificationInput } from '../../shared/jev.js';
import type { DemoInference, DemoReceipt } from '../../shared/portal.js';
import type { TypeSafeJev } from '../adapters/TypeSafeJev.js';
import type { PostgresPortal } from '../infrastructure/PostgresPortal.js';

export class BrowserDemoApi {
  constructor(private readonly store: PostgresPortal, private readonly signingKey: Buffer,
    private readonly jev?: TypeSafeJev) {}

  infer = async (req: Request, res: Response) => {
    const createdAt = new Date();
    const input = readClassificationInput({ subject: req.body?.subject, text: req.body?.text }, createdAt.toISOString());
    if (!input) { res.status(400).json({ error: en.invalidClassification }); return; }

    const started = performance.now();
    let output;
    if (this.jev) {
      try { output = await this.jev.infer(input, AbortSignal.timeout(10000)); }
      catch { /* A provider failure is a counted attempt. Its diagnostic can contain private input. */ }
    }
    const durationMs = Math.round(performance.now() - started);
    if (this.jev) res.append('Server-Timing', `jev;dur=${durationMs}`);
    const attempt = { id: randomUUID(), userId: res.locals.user.id as string, createdAt: createdAt.toISOString(), durationMs };
    const inference = output && { ...attempt, ...output };
    if (inference) res.json({ inference, signature: this.signature(inference) } satisfies DemoReceipt);
    else if (this.jev) res.status(502).json({ error: labels.providerError });
    else res.status(503).json({ error: en.classifierNotConfigured });

    // A closed tab cannot acknowledge a result. The relay also delivers its copy after sending the response.
    try { await this.store.recordDemo(inference ?? attempt, res.statusCode); }
    catch { console.error(en.databaseUnavailable); }
  };

  record = async (req: Request, res: Response) => {
    const { inference, signature } = req.body ?? {};
    if (inference?.userId !== res.locals.user.id || typeof signature !== 'string'
      || Buffer.byteLength(signature) !== 43 || !timingSafeEqual(Buffer.from(this.signature(inference)), Buffer.from(signature))) {
      res.status(400).json({ error: en.invalid }); return;
    }
    await this.store.recordDemo(inference, 200);
    res.sendStatus(204);
  };

  private signature(inference: DemoInference): string {
    return createHmac('sha256', this.signingKey).update('jev-demo-receipt-v1\0').update(JSON.stringify(inference)).digest('base64url');
  }
}
