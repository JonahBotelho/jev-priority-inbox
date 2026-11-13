// Conservative text cleanup and explicit approval of study inputs.
import { Fixtures } from '../adapters/Fixtures.js';

export class MessagePreparation {
  clean(text: string): string {
    return text.split(/\r?\n/).filter(line => !line.trimStart().startsWith('>'))
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
