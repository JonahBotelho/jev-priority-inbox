// Conservative text cleanup and explicit approval of study inputs.
import { Fixtures } from '../adapters/Fixtures.js';
import { maxSubjectLength } from '../../shared/jev.js';

export class MessagePreparation {
  cleanSubject(subject: string): string {
    return this.clean(subject).slice(0, maxSubjectLength).trim();
  }

  clean(text: string): string {
    // PostgreSQL text cannot contain a NUL, even when a received message includes one.
    return text.replaceAll('\0', '').split(/\r?\n/).filter(line => !line.trimStart().startsWith('>'))
      .join('\n').split(/\n(?:On .+wrote:|--\s*$|From:|Sent:)/m)[0]
      .replace(/<[^>]*>/g, '').replace(/https?:\/\/\S+/g, '')
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '').trim();
  }

  approved(subject: string, text: string): boolean {
    return Fixtures.names.some(name => {
      const fixture = Fixtures.get(name);
      return this.clean(fixture.subject) === subject && this.clean(fixture.text) === text;
    });
  }
}
