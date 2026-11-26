// Authenticated portal routes share the inbox's Neon database and server-side Jev adapter.
import express, { Router, type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express';
import { en } from '../../locales/en.js';
import { portalText as labels } from '../../locales/portal.js';
import { jevModel, readClassificationInput } from '../../shared/jev.js';
import type { PortalUser } from '../../shared/portal.js';
import type { Classifier } from '../adapters/Providers.js';
import { TypeSafeJev } from '../adapters/TypeSafeJev.js';
import { PriorityPolicy } from '../../shared/PriorityPolicy.js';
import type { PostgresInbox } from '../infrastructure/PostgresInbox.js';
import { PostgresPortal } from '../infrastructure/PostgresPortal.js';
import { PortalAuth } from './PortalAuth.js';
import { BrowserDemoApi } from './BrowserDemoApi.js';

const productionApi = 'https://jev-priority-inbox-api.onrender.com';
const productionClient = 'https://jev-priority-inbox-client.onrender.com';
const paths = ['/auth', '/classify', '/classifications', '/usage', '/admin', '/demo'];

export class PortalApi {
  readonly router = Router();
  readonly legacyManagement = Router();
  private readonly attempts = new Map<string, number>();
  private resetAttemptsAt = 0;

  private constructor(private readonly store: PostgresPortal, private readonly auth: PortalAuth,
    private readonly adminEmail: string, private readonly origins: Set<string>, demo: BrowserDemoApi, private readonly classifier?: Classifier) {
    this.router.use(paths, this.browserAccess, express.json({ limit: '128kb' }));
    this.router.post('/auth/register', this.register);
    this.router.post('/auth/login', this.login);
    this.router.post('/auth/logout', this.logout);
    this.router.get('/auth/me', this.requireUser, (_req, res) => res.json(res.locals.user));
    this.router.post('/classify', this.requireUser, this.classify);
    this.router.post('/demo/inference', this.requireUser, demo.infer);
    this.router.post('/demo/receipts', this.requireUser, demo.record);
    this.router.get('/usage/me', this.requireUser, async (_req, res) => res.json(await store.usage(res.locals.user.id)));
    this.router.get('/classifications', this.requireUser, async (_req, res) => res.json({ results: await store.history(res.locals.user.id) }));
    this.router.get('/admin/dashboard', this.requireUser, async (_req, res) => {
      if (res.locals.user.role !== 'admin') { res.status(403).json({ error: labels.adminRequired }); return; }
      res.json(await store.dashboard());
    });
    this.router.use(this.onError);
    this.legacyManagement.all('/admin/users/:id', this.requireUser);
    this.legacyManagement.patch('/admin/users/:id', async (req, res) => {
      const role = req.body?.role;
      if (res.locals.user.role !== 'admin') { res.status(403).json({ error: labels.adminRequired }); return; }
      if (role !== 'user' && role !== 'admin') { res.status(400).json({ error: en.invalid }); return; }
      res.sendStatus(await store.manageUser(res.locals.user.id, String(req.params.id), role));
    });
    this.legacyManagement.delete('/admin/users/:id', async (req, res) =>
      res.sendStatus(await store.manageUser(res.locals.user.id, String(req.params.id), 'delete')));
    this.legacyManagement.use(this.onError);
  }

  static async open(database: PostgresInbox, classifier?: Classifier, env: NodeJS.ProcessEnv = process.env): Promise<PortalApi> {
    const store = await PostgresPortal.open(database);
    const api = new URL(env.RENDER_EXTERNAL_URL || env.PUBLIC_URL || `http://localhost:${env.PORT || 8000}`);
    const origins = new Set([api.origin]);
    if (api.origin === productionApi) origins.add(productionClient);
    if (env.CLIENT_ORIGIN || api.protocol === 'http:') {
      const client = env.CLIENT_ORIGIN || 'http://localhost:5173';
      const url = URL.parse(client);
      if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
        throw new Error(labels.configError);
      origins.add(url.origin);
    }
    const configuredKey = env.APP_JWT_SECRET?.trim();
    if (configuredKey && Buffer.byteLength(configuredKey) < 32) throw new Error(labels.configError);
    const key = configuredKey ? Buffer.from(configuredKey) : await store.signingKey();
    const auth = new PortalAuth(key, api.protocol === 'https:' || env.NODE_ENV === 'production');
    const adminEmail = env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() ?? '';
    const apiKey = env.TYPESAFE_API_KEY?.trim();
    const demo = new BrowserDemoApi(store, key, apiKey ? new TypeSafeJev(apiKey, env.TYPESAFE_BASE_URL?.trim() || undefined) : undefined);
    const portal = new PortalApi(store, auth, adminEmail, origins, demo, classifier);
    if (adminEmail && env.INITIAL_ADMIN_PASSWORD) await portal.bootstrapAdmin(env.INITIAL_ADMIN_PASSWORD);
    return portal;
  }

  private async bootstrapAdmin(password: string): Promise<void> {
    if (!PortalAuth.emailPattern.test(this.adminEmail) || !PortalAuth.validPassword(password)) throw new Error(labels.configError);
    const existing = await this.store.userByEmail(this.adminEmail);
    if (existing) {
      if (existing.role !== 'admin') console.error(labels.adminConflict);
      return;
    }
    await this.store.bootstrapAdmin(this.adminEmail, await PortalAuth.hash(password));
  }

  private browserAccess = (req: Request, res: Response, next: NextFunction) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.vary('Origin');
    const origin = req.get('origin');
    if ((origin && !this.origins.has(origin)) || (!origin && req.get('sec-fetch-site') === 'cross-site' && req.method === 'POST')) {
      res.status(403).json({ error: en.forbidden }); return;
    }
    if (origin) res.set({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
    if (req.method === 'OPTIONS') {
      res.set({ 'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      res.sendStatus(204); return;
    }
    next();
  };

  private register = async (req: Request, res: Response) => {
    const email = this.email(req);
    const password = req.body?.password;
    if (email.length > 254 || !PortalAuth.emailPattern.test(email) || !PortalAuth.validPassword(password)) {
      res.status(400).json({ error: en.invalidPassword }); return;
    }
    if (email === this.adminEmail) { res.status(409).json({ error: labels.duplicate }); return; }
    const session = this.auth.newSession();
    const user = await this.store.register(email, await PortalAuth.hash(password), session);
    if (!user) { res.status(409).json({ error: labels.duplicate }); return; }
    this.auth.setCookie(res, user.id, session);
    res.status(201).json(user);
  };

  private login = async (req: Request, res: Response) => {
    if (!this.allowAttempt(req.ip ?? '')) { res.status(429).json({ error: labels.attempts }); return; }
    const email = this.email(req);
    const password = req.body?.password;
    if (email.length > 254 || !PortalAuth.emailPattern.test(email) || !PortalAuth.validPassword(password)) {
      res.status(401).json({ error: labels.credentials }); return;
    }
    const user = await this.store.userByEmail(email);
    if (!user || !await PortalAuth.verify(password, user.password_hash)) {
      res.status(401).json({ error: labels.credentials }); return;
    }
    const session = this.auth.newSession();
    await this.store.startSession(user.id, session);
    this.auth.setCookie(res, user.id, session);
    res.json({ id: user.id, email: user.email, role: user.role });
  };

  private email(req: Request): string {
    return typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  }

  private allowAttempt(ip: string): boolean {
    const now = Date.now();
    if (now >= this.resetAttemptsAt) { this.attempts.clear(); this.resetAttemptsAt = now + 60000; }
    const count = (this.attempts.get(ip) ?? 0) + 1;
    this.attempts.set(ip, count);
    return count <= 10;
  }

  private requireUser = async (req: Request, res: Response, next: NextFunction) => {
    const claims = this.auth.claims(req);
    const user = claims && await this.store.sessionUser(claims.sessionId, claims.userId);
    if (!user) { res.status(401).json({ error: en.unauthorized }); return; }
    res.locals.user = user; next();
  };

  private logout = async (req: Request, res: Response) => {
    const claims = this.auth.claims(req);
    if (claims) await this.store.endSession(claims.sessionId, claims.userId);
    this.auth.clearCookie(res); res.sendStatus(204);
  };

  private classify = async (req: Request, res: Response) => {
    const user = res.locals.user as PortalUser;
    const input = readClassificationInput(req.body, new Date().toISOString());
    if (!input) { res.status(400).json({ error: en.invalidClassification }); return; }
    const started = Date.now();
    // Persist the caller's attempt before contacting the billable provider.
    const id = await this.store.startRequest(user.id);
    if (!this.classifier) {
      await this.store.finishRequest(id, 503, Date.now() - started);
      res.status(503).json({ error: en.classifierNotConfigured }); return;
    }
    let decision;
    try { decision = new PriorityPolicy().decide(await this.classifier.classify(input, AbortSignal.timeout(10000))); }
    catch {
      await this.store.finishRequest(id, 502, Date.now() - started);
      res.status(502).json({ error: labels.providerError }); return;
    }
    const durationMs = Date.now() - started;
    const result = { tier: decision.tier, score: Math.round(decision.score), model: jevModel };
    await this.store.finishRequest(id, 200, durationMs, result);
    res.json({ id, ...result, provider: 'Jev', durationMs });
  };

  private onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) { next(err); return; }
    const status = err.status === 400 || err.status === 413 ? err.status : 503;
    res.status(status).json({ error: status === 503 ? en.unavailable : en.invalid });
  };
}
