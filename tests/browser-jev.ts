// Loopback-only Jev stand-in for browser tests. Reuse the approved fixture decisions.
import express from 'express';
import { Fixtures } from '../src/server/adapters/Fixtures.js';
import { jevModel } from '../src/shared/jev.js';
const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.sendStatus(200));
app.post('/classify', (req, res) => {
  if (req.get('Authorization') !== 'Bearer local-browser-fixture') { res.sendStatus(401); return; }
  try { res.json(Fixtures.probabilities(req.body.subject, req.body.text)); }
  catch { res.sendStatus(422); }
});
app.post('/v1/systemone', (req, res) => {
  if (req.get('Authorization') !== 'Bearer local-typesafe-fixture') { res.sendStatus(401); return; }
  try {
    const { subject, text } = req.body.state;
    const probabilities = Fixtures.probabilities(subject, text);
    res.json({ model: jevModel, answers: { urgency: { type: 'choice', probabilities } }, usage: { input_tokens: 75, output_tokens: 4 } });
  } catch { res.sendStatus(422); }
});
app.listen(3102, '127.0.0.1');
