// Authenticated fixture delivery through the running application's normal intake service.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { en } from '../locales/en.js';

class DemoDelivery {
  static async run(): Promise<void> {
    const base = `http://127.0.0.1:${process.env.PORT ?? 8000}/v1`;
    const session = await fetch(`${base}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: process.env.MAILBOX_PASSWORD }) });
    if (!session.ok) throw new Error(en.invalidLogin);
    const response = await fetch(`${base}/demo/deliver`, { method: 'POST', headers: {
      'Content-Type': 'application/json', Cookie: session.headers.get('set-cookie')!.split(';')[0],
    }, body: JSON.stringify({ name: process.argv[2], deliveryId: process.argv[3] ?? randomUUID() }) });
    if (!response.ok) throw new Error((await response.json() as { error: string }).error);
    console.log(en.delivered);
  }
}

DemoDelivery.run().catch(error => { console.error(error.message); process.exitCode = 1; });
