// Signed, expiring mailbox sessions and constant-time credential comparison.
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Config } from '../config.js';

export class Sessions {
  constructor(private readonly config: Config) {}

  matches(password: string): boolean {
    const digest = (value: string) => createHash('sha256').update(value).digest();
    return timingSafeEqual(digest(password), digest(this.config.password));
  }

  issue(request: Request, response: Response): void {
    const payload = Buffer.from(JSON.stringify({ mailbox: this.config.mailbox, expires: Date.now() + 8 * 3600000 })).toString('base64url');
    response.cookie('session', `${payload}.${this.sign(payload)}`, this.options(request));
  }

  clear(request: Request, response: Response): void {
    response.clearCookie('session', this.options(request));
  }

  mailbox(request: Request): string | undefined {
    const token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('session='))?.slice(8);
    if (!token) return;
    const [payload, signature] = token.split('.');
    const expected = this.sign(payload);
    if (!signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)
      || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return;
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (session.expires > Date.now() && session.mailbox === this.config.mailbox) return session.mailbox;
    } catch { return; }
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.config.secret).update(payload).digest('base64url');
  }

  private options(request: Request) {
    return { httpOnly: true, sameSite: 'strict' as const, secure: request.secure, maxAge: 8 * 3600000, path: '/' };
  }
}
