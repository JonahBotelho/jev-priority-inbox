// Single account-based website with periodic mailbox synchronization.
import { Config } from './config.js';
import { Database } from './infrastructure/Database.js';
import { ChangeEvents } from './application/ChangeEvents.js';
import { en } from '../locales/en.js';
import { MailStore } from './mail/MailStore.js';
import { MailService } from './mail/MailService.js';
import { ConnectedApplication } from './mail/ConnectedApplication.js';

class Server {
  static start(): void {
    const config = new Config();
    const database = new Database(config.databasePath);
    const store = new MailStore(database, config.encryptionKey);
    const service = new MailService(store, config, new ChangeEvents());
    const server = new ConnectedApplication(config, store, service).app.listen(config.port, () => console.log(en.listening, config.port));
    let syncing = false;
    const sync = async () => {
      if (syncing) return;
      syncing = true;
      try { await service.tick(); } finally { syncing = false; }
    };
    const refresh = () => { void sync().catch(() => console.error(en.unavailable)); };
    refresh();
    const timer = setInterval(refresh, 60000);
    const shutdown = () => {
      clearInterval(timer);
      server.close();
      server.closeAllConnections();
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }
}

Server.start();
