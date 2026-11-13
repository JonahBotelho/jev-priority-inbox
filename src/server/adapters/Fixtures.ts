// Approved fictional study messages and deterministic demo classifications.
import { en } from '../../locales/en.js';
import type { Probabilities, Tier } from '../../shared/types.js';

export class Fixtures {
  static readonly names = Object.keys(en.fixtures) as (keyof typeof en.fixtures)[];
  private static readonly decisions: Record<keyof typeof en.fixtures, { expected: Tier; probabilities: Probabilities }> = {
    outage: { expected: 'Emergency', probabilities: { Emergency: 0.94, Urgent: 0.05, Routine: 0.01 } },
    recovery: { expected: 'Routine', probabilities: { Emergency: 0.01, Urgent: 0.02, Routine: 0.97 } },
    signoff: { expected: 'Urgent', probabilities: { Emergency: 0.06, Urgent: 0.86, Routine: 0.08 } },
    sale: { expected: 'Routine', probabilities: { Emergency: 0.01, Urgent: 0.02, Routine: 0.97 } },
    security: { expected: 'Emergency', probabilities: { Emergency: 0.98, Urgent: 0.01, Routine: 0.01 } },
    database: { expected: 'Emergency', probabilities: { Emergency: 0.84, Urgent: 0.14, Routine: 0.02 } },
    deployment: { expected: 'Urgent', probabilities: { Emergency: 0.12, Urgent: 0.79, Routine: 0.09 } },
    certificate: { expected: 'Urgent', probabilities: { Emergency: 0.23, Urgent: 0.73, Routine: 0.04 } },
    digest: { expected: 'Routine', probabilities: { Emergency: 0.01, Urgent: 0.05, Routine: 0.94 } },
  };

  static get(name: string) {
    if (!Fixtures.names.includes(name as typeof Fixtures.names[number])) throw new Error(en.fixtureHelp);
    return en.fixtures[name as keyof typeof en.fixtures];
  }

  static expected(name: string): Tier {
    Fixtures.get(name);
    return Fixtures.decisions[name as keyof typeof en.fixtures].expected;
  }

  static probabilities(subject: string, text: string): Probabilities {
    const name = Fixtures.names.find(key => {
      const fixture = Fixtures.get(key);
      return fixture.subject === subject && fixture.text === text;
    });
    if (!name) throw new Error('Unapproved fixture');
    return { ...Fixtures.decisions[name].probabilities };
  }
}
