// Populate the demo database through the normal intake and classification pipeline.
import { Config } from '../server/config.js';
import { Database } from '../server/infrastructure/Database.js';
import { InboxRepository } from '../server/infrastructure/InboxRepository.js';
import { Fixtures } from '../server/adapters/Fixtures.js';
import { DemoMailbox, DemoClassifier } from '../server/adapters/Providers.js';
import { Worker } from '../server/application/Worker.js';
import { ChangeEvents } from '../server/application/ChangeEvents.js';
import { en } from '../locales/en.js';

class DemoSeed {
  static async run(): Promise<void> {
    const config = new Config();
    if (config.mode !== 'demo') throw new Error(en.demoOnly);

    const database = new Database(config.databasePath);
    try {
      const repository = new InboxRepository(database);
      const worker = new Worker(repository, new DemoMailbox(), new DemoClassifier(), new ChangeEvents(), config);
      const now = Date.now();

      Fixtures.names.forEach((name, index) => {
        // Stable IDs make repeat runs safe without resetting handled or corrected mail.
        const receivedAt = new Date(now - index * 5 * 60000).toISOString();
        repository.accept(config.mailbox, `${name}:demo-seed-v1`, receivedAt);
      });

      const { pending } = repository.snapshot(config.mailbox).processing;
      for (let index = 0; index < pending; index++) await worker.tick();
      console.log(en.seeded);
    } finally {
      database.connection.close();
    }
  }
}

DemoSeed.run().catch(error => { console.error(error.message); process.exitCode = 1; });
