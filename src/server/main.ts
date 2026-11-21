// Start the public demo API and finish reviewing any outstanding sample emails.
import 'dotenv/config';
import { JevClassifier } from './adapters/Providers.js';
import { PublicPriorityInbox } from './application/PublicPriorityInbox.js';
import { createPublicInboxApi } from './http/PublicInboxApi.js';
import { Database } from './infrastructure/Database.js';
import { en } from '../locales/en.js';

const port = Number(process.env.PORT ?? 8000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(en.config);
const database = new Database(process.env.SQLITE_PATH || './data/mail.sqlite');
const inbox = new PublicPriorityInbox(database, JevClassifier.fromEnvironment());
const server = createPublicInboxApi(inbox).listen(port, () => console.log(en.listening, port));
const controller = new AbortController();
const reviewing = inbox.reviewPending(controller.signal).catch(() => console.error(en.unavailable));

function shutdown() {
  controller.abort();
  server.close(() => { void reviewing.then(() => database.connection.close()); });
  server.closeAllConnections();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
