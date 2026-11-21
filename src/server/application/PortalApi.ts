// Own-user authentication, role authorization, Jev inference, and API usage records.
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Database } from '../infrastructure/Database.js';
import type { Config } from '../config.js';
import { JevClassifier, type Classifier } from '../adapters/Providers.js';
import { PriorityPolicy } from '../domain/PriorityPolicy.js';
import { jevModel, readClassificationInput } from '../../shared/jev.js';
import { en } from '../../locales/en.js';

const deriveKey = (password: string, salt: Buffer, length: number) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password, salt, length, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (error, key) => {
    if (error) reject(error); else resolve(key as Buffer);
  });
});
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const lifetimeSeconds = 8 * 60 * 60;

type Role = 'user' | 'admin';
export interface PortalUser { id: string; email: string; role: Role; created_at: string }

export class PortalApi {
  readonly router = Router();
  private readonly attempts = new Map<string, { count: number; until: number }>();
  private readonly classifier?: Pick<Classifier, 'classify'>;

  constructor(private readonly database: Database, private readonly config: Config, classifierOverride?: Pick<Classifier, 'classify'>) {
    database.connection.exec(`
      CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','admin')), created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS api_usage (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL, status INTEGER NOT NULL, duration_ms INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS classification_results (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        tier TEXT NOT NULL CHECK(tier IN ('Emergency','Urgent','Routine')), score REAL NOT NULL,
        model TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS api_usage_user_time ON api_usage(user_id, created_at);
    `);
    this.classifier = classifierOverride ?? JevClassifier.fromEnvironment();
    this.router.post('/auth/register', this.register);
    this.router.post('/auth/login', this.login);
    this.router.post('/auth/logout', this.logout);
    this.router.get('/auth/me', this.requireUser, this.me);
    this.router.post('/classify', this.requireUser, this.classify);
    this.router.get('/classifications', this.requireUser, this.classificationHistory);
    this.router.get('/usage/me', this.requireUser, this.myUsage);
    this.router.get('/admin/dashboard', this.requireAdmin, this.dashboard);
    this.router.patch('/admin/users/:id', this.requireAdmin, this.updateUser);
    this.router.delete('/admin/users/:id', this.requireAdmin, this.deleteUser);
    this.router.get('/health', (_request, response) => response.json({ status: 'ok' }));
  }

  async bootstrapAdmin(): Promise<void> {
    const email = this.config.initialAdminEmail;
    const existing = this.database.connection.prepare('SELECT id FROM app_users WHERE email=?').get(email) as { id: string } | undefined;
    if (existing) {
      this.database.connection.prepare("UPDATE app_users SET role='admin' WHERE id=?").run(existing.id);
      return;
    }
    const id = randomBytes(16).toString('hex');
    const passwordHash = await this.hashPassword(this.config.initialAdminPassword);
    this.database.connection.prepare("INSERT INTO app_users(id,email,password_hash,role,created_at) VALUES(?,?,?,'admin',?)")
      .run(id, email, passwordHash, new Date().toISOString());
  }

  private register = async (request: Request, response: Response) => {
    const { email: rawEmail, password } = request.body ?? {};
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!emailPattern.test(email) || typeof password !== 'string' || password.length < 3 || password.length > 256) {
      response.status(400).json({ error: en.invalidPassword }); return;
    }
    if (this.database.connection.prepare('SELECT 1 FROM app_users WHERE email=?').get(email)) {
      response.status(409).json({ error: 'An account with this email already exists.' }); return;
    }
    const id = randomBytes(16).toString('hex');
    const hash = await this.hashPassword(password);
    this.database.connection.prepare("INSERT INTO app_users(id,email,password_hash,role,created_at) VALUES(?,?,?,'user',?)")
      .run(id, email, hash, new Date().toISOString());
    this.issueSession(response, { id, email, role: 'user', created_at: new Date().toISOString() });
    response.status(201).json({ id, email, role: 'user' });
  };

  private login = async (request: Request, response: Response) => {
    if (!this.allowAttempt(request.ip ?? '')) { response.status(429).json({ error: 'Too many login attempts. Try again shortly.' }); return; }
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = request.body?.password;
    const user = this.database.connection.prepare('SELECT id,email,password_hash,role,created_at FROM app_users WHERE email=?')
      .get(email) as (PortalUser & { password_hash: string }) | undefined;
    if (!user || typeof password !== 'string' || !await this.verifyPassword(password, user.password_hash)) {
      response.status(401).json({ error: 'Email or password is incorrect.' }); return;
    }
    this.issueSession(response, user);
    response.json({ id: user.id, email: user.email, role: user.role });
  };

  private logout = (request: Request, response: Response) => {
    const claims = this.sessionClaims(request);
    if (claims) this.database.connection.prepare('DELETE FROM app_sessions WHERE id=?').run(claims.sessionId);
    response.clearCookie('app_session', this.cookieOptions()); response.sendStatus(204);
  };

  private me = (_request: Request, response: Response) => {
    const { id, email, role } = response.locals.portalUser as PortalUser;
    response.json({ id, email, role });
  };

  private classify = async (request: Request, response: Response) => {
    const user = response.locals.portalUser as PortalUser;
    const input = readClassificationInput(request.body, new Date().toISOString());
    if (!input) {
      response.status(400).json({ error: en.invalidClassification }); return;
    }
    const started = Date.now();
    if (!this.classifier) {
      this.recordUsage(user.id, '/v1/classify', 503, Date.now() - started);
      response.status(503).json({ error: en.classifierNotConfigured }); return;
    }
    try {
      const scores = await this.classifier.classify(input, AbortSignal.timeout(10000));
      const decision = new PriorityPolicy().decide(scores);
      const duration = Date.now() - started;
      const id = randomBytes(16).toString('hex');
      this.database.connection.prepare('INSERT INTO classification_results(id,user_id,tier,score,model,created_at) VALUES(?,?,?,?,?,?)')
        .run(id, user.id, decision.tier, Math.round(decision.score), jevModel, new Date().toISOString());
      this.recordUsage(user.id, '/v1/classify', 200, duration);
      response.json({ id, tier: decision.tier, score: Math.round(decision.score), provider: 'Jev', model: jevModel, durationMs: duration });
    } catch {
      this.recordUsage(user.id, '/v1/classify', 502, Date.now() - started);
      response.status(502).json({ error: 'The AI classification service did not return a valid result.' });
    }
  };

  private myUsage = (_request: Request, response: Response) => {
    const user = response.locals.portalUser as PortalUser;
    const summary = this.database.connection.prepare(`SELECT COUNT(*) AS requests,
      SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS successful,
      MAX(created_at) AS last_request FROM api_usage WHERE user_id=?`).get(user.id) as { requests: number; successful: number | null; last_request: string | null };
    response.json({ requests: summary.requests, successful: summary.successful ?? 0, lastRequest: summary.last_request });
  };

  private classificationHistory = (_request: Request, response: Response) => {
    const user = response.locals.portalUser as PortalUser;
    const results = this.database.connection.prepare(`SELECT id,tier,score,model,created_at AS createdAt
      FROM classification_results WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).all(user.id);
    response.json({ results });
  };

  private dashboard = (_request: Request, response: Response) => {
    const users = this.database.connection.prepare(`SELECT u.id,u.email,u.role,u.created_at AS createdAt,
      COUNT(a.id) AS requests FROM app_users u LEFT JOIN api_usage a ON a.user_id=u.id
      GROUP BY u.id ORDER BY u.created_at DESC`).all();
    const totals = this.database.connection.prepare(`SELECT COUNT(*) AS requests,
      SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS successful FROM api_usage`).get();
    const recent = this.database.connection.prepare(`SELECT u.email,a.endpoint,a.status,a.duration_ms AS durationMs,a.created_at AS createdAt
      FROM api_usage a JOIN app_users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 100`).all();
    response.json({ users, totals, recent });
  };

  private updateUser = (request: Request, response: Response) => {
    const target = String(request.params.id);
    const role = request.body?.role;
    if (!['user', 'admin'].includes(role)) { response.status(400).json({ error: 'Role must be user or admin.' }); return; }
    const exists = this.database.connection.prepare('SELECT id FROM app_users WHERE id=?').get(target);
    if (!exists) { response.status(404).json({ error: 'User not found.' }); return; }
    if (role === 'user') {
      const admins = this.database.connection.prepare("SELECT COUNT(*) AS count FROM app_users WHERE role='admin'").get() as { count: number };
      if (admins.count < 2 && (response.locals.portalUser as PortalUser).id === target) {
        response.status(409).json({ error: 'Promote another administrator before changing your own role.' }); return;
      }
    }
    this.database.connection.prepare('UPDATE app_users SET role=? WHERE id=?').run(role, target);
    response.sendStatus(204);
  };

  private deleteUser = (request: Request, response: Response) => {
    const target = String(request.params.id);
    if ((response.locals.portalUser as PortalUser).id === target) { response.status(409).json({ error: 'You cannot delete your own account.' }); return; }
    const user = this.database.connection.prepare('SELECT role FROM app_users WHERE id=?').get(target) as { role: string } | undefined;
    if (!user) { response.status(404).json({ error: 'User not found.' }); return; }
    if (user.role === 'admin') {
      const admins = this.database.connection.prepare("SELECT COUNT(*) AS count FROM app_users WHERE role='admin'").get() as { count: number };
      if (admins.count < 2) { response.status(409).json({ error: 'The last administrator cannot be deleted.' }); return; }
    }
    this.database.connection.prepare('DELETE FROM app_users WHERE id=?').run(target);
    response.sendStatus(204);
  };

  private requireUser = (request: Request, response: Response, next: NextFunction) => {
    const claims = this.sessionClaims(request);
    if (!claims || !this.database.connection.prepare('SELECT 1 FROM app_sessions WHERE id=? AND expires_at>?').get(claims.sessionId, Date.now())) {
      response.status(401).json({ error: 'Please sign in.' }); return;
    }
    const user = this.database.connection.prepare('SELECT id,email,role,created_at FROM app_users WHERE id=?').get(claims.id) as PortalUser | undefined;
    if (!user) { response.status(401).json({ error: 'Please sign in.' }); return; }
    response.locals.portalUser = user; next();
  };

  private requireAdmin = (request: Request, response: Response, next: NextFunction) => {
    this.requireUser(request, response, () => {
      if ((response.locals.portalUser as PortalUser).role !== 'admin') { response.status(403).json({ error: 'Administrator access is required.' }); return; }
      next();
    });
  };

  private issueSession(response: Response, user: PortalUser): void {
    const sessionId = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + lifetimeSeconds * 1000;
    this.database.connection.prepare('DELETE FROM app_sessions WHERE expires_at<?').run(Date.now());
    this.database.connection.prepare('INSERT INTO app_sessions(id,user_id,expires_at) VALUES(?,?,?)').run(sessionId, user.id, expiresAt);
    const payload = Buffer.from(JSON.stringify({ sub: user.id, jti: sessionId, exp: Math.floor(expiresAt / 1000) })).toString('base64url');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const signed = `${header}.${payload}`;
    const signature = createHmac('sha256', this.config.jwtSecret).update(signed).digest('base64url');
    response.cookie('app_session', `${signed}.${signature}`, { ...this.cookieOptions(), maxAge: lifetimeSeconds * 1000 });
  }

  private verifyToken(token: string): { id: string; sessionId: string } | undefined {
    const [header, payload, signature, extra] = token.split('.');
    if (!header || !payload || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(signature)) return undefined;
    const signed = `${header}.${payload}`;
    const expected = createHmac('sha256', this.config.jwtSecret).update(signed).digest();
    let actual: Buffer;
    try { actual = Buffer.from(signature, 'base64url'); } catch { return undefined; }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: unknown; jti?: unknown; exp?: unknown };
      return typeof value.sub === 'string' && typeof value.jti === 'string' && typeof value.exp === 'number' && value.exp > Date.now() / 1000
        ? { id: value.sub, sessionId: value.jti } : undefined;
    } catch { return undefined; }
  }

  private sessionClaims(request: Request): { id: string; sessionId: string } | undefined {
    const value = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('app_session='))?.slice(12) ?? '';
    try { return this.verifyToken(decodeURIComponent(value)); } catch { return undefined; }
  }

  private cookieOptions() {
    const secure = this.config.publicUrl.startsWith('https://');
    return { httpOnly: true, secure, sameSite: secure ? 'none' as const : 'lax' as const, path: '/' };
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const digest = await deriveKey(password, salt, 64);
    return `scrypt$32768$8$1$${salt.toString('hex')}$${digest.toString('hex')}`;
  }

  private async verifyPassword(password: string, encoded: string): Promise<boolean> {
    const [, n, r, p, saltHex, digestHex] = encoded.split('$');
    if (n !== '32768' || r !== '8' || p !== '1' || !saltHex || !digestHex) return false;
    const expected = Buffer.from(digestHex, 'hex');
    const actual = await deriveKey(password, Buffer.from(saltHex, 'hex'), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private allowAttempt(ip: string): boolean {
    const now = Date.now();
    const attempt = this.attempts.get(ip);
    if (!attempt || attempt.until <= now) { this.attempts.set(ip, { count: 1, until: now + 60000 }); return true; }
    attempt.count++;
    return attempt.count <= 10;
  }

  private recordUsage(userId: string, endpoint: string, status: number, duration: number): void {
    this.database.connection.prepare('INSERT INTO api_usage(id,user_id,endpoint,status,duration_ms,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomBytes(16).toString('hex'), userId, endpoint, status, duration, new Date().toISOString());
  }
}
