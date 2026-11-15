// Keep inbox snippets compact while full message bodies remain provider-backed.
export class MessagePreview {
  static from(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, 240);
  }
}
