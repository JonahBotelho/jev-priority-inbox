// Loopback-only Jev stand-in for browser tests. Reuse the approved fixture decisions.
import express from 'express';
import { Fixtures } from '../src/server/adapters/Fixtures.js';
const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.sendStatus(200));
app.post('/classify', (req, res) => {
  if (req.get('Authorization') !== 'Bearer local-browser-fixture') { res.sendStatus(401); return; }
  try { res.json(Fixtures.probabilities(req.body.subject, req.body.text)); }
  catch { res.sendStatus(422); }
});
app.listen(3102, '127.0.0.1');
