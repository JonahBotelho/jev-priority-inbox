// External ports and provider adapters, with cancellation on every request.
import { readUrgencyProbabilities } from '../../shared/jev.js';
import type { ClassificationInput, Message, Probabilities } from '../../shared/types.js';
import { Fixtures } from './Fixtures.js';
import { en } from '../../locales/en.js';

export interface MailboxProvider { fetch(id: string, signal: AbortSignal): Promise<Message> }
export interface Classifier { classify(input: ClassificationInput, signal: AbortSignal): Promise<Probabilities> }

export class ProviderError extends Error {
  constructor(readonly transient: boolean) { super('Provider request failed'); }
}

export class DemoMailbox implements MailboxProvider {
  async fetch(id: string): Promise<Message> {
    const fixture = Fixtures.get(id.split(':')[0]);
    return { ...fixture, from: en.fictionalSender, receivedAt: new Date().toISOString() };
  }
}

export class DemoClassifier implements Classifier {
  async classify(input: ClassificationInput): Promise<Probabilities> {
    return Fixtures.probabilities(input.subject, input.text);
  }
}

export class JevClassifier implements Classifier {
  private constructor(private readonly endpoint: URL, private readonly secret: string) {}

  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): JevClassifier | undefined {
    const endpoint = URL.parse(environment.JEV_FUNCTION_URL ?? '');
    const secret = environment.JEV_FUNCTION_SECRET?.trim();
    if (!endpoint || !secret || endpoint.username || endpoint.password) return undefined;
    const localHttp = endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' && !localHttp) return undefined;
    return new JevClassifier(endpoint, secret);
  }

  async classify(input: ClassificationInput, signal: AbortSignal): Promise<Probabilities> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      redirect: 'error',
      signal,
    });
    if (!response.ok) throw new ProviderError(response.status === 429 || response.status >= 500);
    return readUrgencyProbabilities(await response.json());
  }
}

