// Single-process composition root for HTTP, durable worker, and retention cleanup.
import { Config } from './config.js';
import { Database } from './infrastructure/Database.js';
import { InboxRepository } from './infrastructure/InboxRepository.js';
import { ChangeEvents } from './application/ChangeEvents.js';
import { Worker } from './application/Worker.js';
import { DemoMailbox, DemoClassifier, ResendMailbox, JevClassifier } from './adapters/Providers.js';
import { Application } from './http/Application.js';
import { en } from '../locales/en.js';
import { MailStore } from './mail/MailStore.js';
import { MailService } from './mail/MailService.js';
import { ConnectedApplication } from './mail/ConnectedApplication.js';

class Server {
  static start(): void {
    const config = new Config();
    const database = new Database(config.databasePath);
    if (config.mode === 'connected') {
      const store = new MailStore(database, config.encryptionKey);
      const service = new MailService(store, config, new ChangeEvents());
      const server = new ConnectedApplication(config, store, service).app.listen(config.port, () => console.log(en.listening, config.port));
      let syncing = false;
      const sync = async () => {
        if (syncing) return;
        syncing = true;
        try { await service.tick(); } finally { syncing = false; }
      };
      void sync();
      const timer = setInterval(() => { void sync().catch(() => console.error(en.unavailable)); }, 60000);
      const shutdown = () => { clearInterval(timer); server.close(); server.closeAllConnections(); };
      process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
      return;
    }
    const repository = new InboxRepository(database);
    const events = new ChangeEvents();
    const provider = config.mode === 'demo' ? new DemoMailbox() : new ResendMailbox(config.resendKey);
    const classifier = config.mode === 'demo' ? new DemoClassifier() : new JevClassifier(config.jevKey);
    const worker = new Worker(repository, provider, classifier, events, config);
    repository.recover();
    repository.purge();
    const timer = setInterval(() => { void worker.tick().catch(() => console.error(en.unavailable)); }, 250);
    const retention = setInterval(() => { repository.purge(); events.publish(config.mailbox); }, 3600000);
    const server = new Application(config, repository, provider, events).app.listen(config.port, () => console.log(en.listening, config.port));
    const shutdown = () => {
      clearInterval(timer);
      clearInterval(retention);
      server.close();
      server.closeAllConnections();
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }
}

Server.start();
