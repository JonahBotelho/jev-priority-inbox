// Start the public inbox API and keep its durable review queue available for incoming mail.
import 'dotenv/config';
import { JevClassifier } from './adapters/Providers.js';
import { ResendMailbox } from './adapters/ResendMailbox.js';
import { PublicPriorityInbox } from './application/PublicPriorityInbox.js';
import { PortalApi } from './application/PortalApi.js';
import { createPublicInboxApi } from './http/PublicInboxApi.js';
import { PostgresInbox } from './infrastructure/PostgresInbox.js';
import { en } from '../locales/en.js';

const port = Number(process.env.PORT ?? 8000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(en.config);
const database = await PostgresInbox.open(process.env.DATABASE_URL);
const classifier = JevClassifier.fromEnvironment();
const inbox = await PublicPriorityInbox.open(database, classifier, ResendMailbox.fromEnvironment());
const portal = await PortalApi.open(database, classifier);
const server = createPublicInboxApi(inbox, portal).listen(port, () => console.log(en.listening, port));
const controller = new AbortController();
const reviewing = inbox.run(controller.signal).catch(() => console.error(en.unavailable));

function shutdown() {
  controller.abort();
  server.close(() => { void reviewing.then(() => database.pool.end()); });
  server.closeAllConnections();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
