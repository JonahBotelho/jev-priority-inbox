// Self-managed password hashing and signed HttpOnly session cookies. PostgreSQL enforces revocation.
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { PortalSession } from '../infrastructure/PostgresPortal.js';

const lifetimeMs = 8 * 60 * 60 * 1000;
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const cookieName = 'app_session';
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export class PortalAuth {
  static readonly emailPattern = /^[^\s<>@\p{Cc}]+@[^\s<>@\p{Cc}]+\.[^\s<>@\p{Cc}]+$/u;
  constructor(private readonly key: Buffer, private readonly secure: boolean) {}

  static validPassword(password: unknown): password is string {
    return typeof password === 'string' && password.length >= 3 && password.length <= 256;
  }

  static async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const digest = await PortalAuth.derive(password, salt);
    return ['scrypt', '32768', '8', '1', salt.toString('hex'), digest.toString('hex')].join('$');
  }

  static async verify(password: string, encoded: string): Promise<boolean> {
    const match = /^scrypt\$32768\$8\$1\$([a-f\d]{32})\$([a-f\d]{128})$/i.exec(encoded);
    if (!match) return false;
    return timingSafeEqual(await PortalAuth.derive(password, Buffer.from(match[1], 'hex')), Buffer.from(match[2], 'hex'));
  }

  private static derive(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 },
      (error, digest) => error ? reject(error) : resolve(digest)));
  }

  newSession(): PortalSession { return { id: randomUUID(), expiresAt: new Date(Date.now() + lifetimeMs) }; }

  setCookie(response: Response, userId: string, session: PortalSession): void {
    const payload = Buffer.from(JSON.stringify({ sub: userId, jti: session.id, exp: Math.floor(session.expiresAt.getTime() / 1000) })).toString('base64url');
    const signed = header + '.' + payload;
    response.cookie(cookieName, signed + '.' + this.signature(signed).toString('base64url'), { ...this.cookieOptions(), maxAge: lifetimeMs });
  }

  clearCookie(response: Response): void { response.clearCookie(cookieName, this.cookieOptions()); }

  claims(request: Request): { userId: string; sessionId: string } | undefined {
    const cookie = request.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(cookieName + '='));
    if (!cookie) return undefined;
    const parts = cookie.slice(cookieName.length + 1).split('.');
    if (parts.length !== 3 || parts[0] !== header) return undefined;
    const supplied = Buffer.from(parts[2], 'base64url');
    const expected = this.signature(parts[0] + '.' + parts[1]);
    if (supplied.length !== expected.length || supplied.toString('base64url') !== parts[2] || !timingSafeEqual(supplied, expected)) return undefined;
    try {
      const { sub, jti, exp } = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (typeof sub === 'string' && uuid.test(sub) && typeof jti === 'string' && uuid.test(jti) && typeof exp === 'number' && exp > Date.now() / 1000)
        return { userId: sub, sessionId: jti };
    } catch { /* A malformed cookie is an unauthenticated request. */ }
    return undefined;
  }

  private signature(value: string): Buffer { return createHmac('sha256', this.key).update(value).digest(); }
  private cookieOptions() {
    return { httpOnly: true, secure: this.secure, sameSite: this.secure ? 'none' as const : 'lax' as const,
      partitioned: this.secure, path: '/' };
  }
}
