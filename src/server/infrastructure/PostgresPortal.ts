// Portal accounts, revocable sessions and per-user classification receipts in the existing Neon database.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildUsageQuota, demoHistoryEntry, type ClassificationUpdate, type DemoAttempt, type DemoInference, type EndpointStat, type PortalDashboard, type PortalHistory,
  type PortalRole, type PortalUsage, type PortalUser } from '../../shared/portal.js';
import { portalText } from '../../locales/portal.js';
import type { Tier } from '../../shared/types.js';
import type { PostgresInbox } from './PostgresInbox.js';

export interface PortalSession { id: string; expiresAt: Date }
export interface AuthenticatedSession { user: PortalUser; apiRequests: number }
interface StoredUser extends PortalUser { password_hash: string }
interface StoredUsageRow {
  requests: number;
  successful: number;
  lastRequest: string | null;
  netlifyCreditBalance: { remaining: string; checkedAt: string } | null;
}

export class PostgresPortal {
  private constructor(private readonly database: PostgresInbox) {}

  static async open(database: PostgresInbox): Promise<PostgresPortal> {
    const schema = await readFile(new URL('../../../db/portal.sql', import.meta.url), 'utf8');
    await database.transaction(client => client.query(schema));
    return new PostgresPortal(database);
  }

  async signingKey(): Promise<Buffer> {
    return this.database.transaction(async client => {
      await client.query('INSERT INTO app_portal_signing_key VALUES(true,$1) ON CONFLICT DO NOTHING', [randomBytes(32)]);
      const { rows } = await client.query<{ key_bytes: Buffer }>('SELECT key_bytes FROM app_portal_signing_key WHERE singleton');
      return rows[0].key_bytes;
    });
  }

  async userByEmail(email: string): Promise<StoredUser | undefined> {
    const result = await this.database.pool.query<StoredUser>('SELECT id,email,role,password_hash FROM app_users WHERE email=$1', [email]);
    return result.rows[0];
  }

  async bootstrapAdmin(email: string, hash: string): Promise<void> {
    // An email collision cannot promote an existing registration or change its password.
    await this.database.pool.query(`INSERT INTO app_users (id,email,password_hash,role) VALUES ($1,$2,$3,'admin')
      ON CONFLICT (email) DO NOTHING`, [randomUUID(), email, hash]);
  }

  async register(email: string, hash: string, session: PortalSession): Promise<PortalUser | undefined> {
    return this.database.transaction(async client => {
      const { rows } = await client.query<PortalUser>(`INSERT INTO app_users (id,email,password_hash) VALUES ($1,$2,$3)
        ON CONFLICT (email) DO NOTHING RETURNING id,email,role`, [randomUUID(), email, hash]);
      if (rows[0]) await client.query('INSERT INTO app_sessions (id,user_id,expires_at) VALUES ($1,$2,$3)', [session.id, rows[0].id, session.expiresAt]);
      return rows[0];
    });
  }

  async startSession(userId: string, session: PortalSession): Promise<void> {
    await this.database.pool.query(`WITH expired AS (DELETE FROM app_sessions WHERE expires_at <= now())
      INSERT INTO app_sessions (id,user_id,expires_at) VALUES ($1,$2,$3)`, [session.id, userId, session.expiresAt]);
  }

  async sessionUser(sessionId: string, userId: string): Promise<AuthenticatedSession | undefined> {
    const { rows } = await this.database.pool.query<PortalUser & { apiRequests: number }>(
      `SELECT u.id,u.email,u.role,
         COALESCE((SELECT SUM(requests)::int FROM api_user_endpoint_stats
           WHERE user_id=u.id AND NOT (method='GET' AND endpoint='/v1/usage/me')), 0) AS "apiRequests"
       FROM app_sessions s
       JOIN app_users u ON u.id=s.user_id WHERE s.id=$1 AND u.id=$2 AND s.expires_at > now()`,
      [sessionId, userId],
    );
    if (!rows[0]) return undefined;
    const { apiRequests, ...user } = rows[0];
    return { user, apiRequests };
  }

  async endSession(sessionId: string, userId: string): Promise<void> {
    await this.database.pool.query('DELETE FROM app_sessions WHERE id=$1 AND user_id=$2', [sessionId, userId]);
  }

  async startRequest(userId: string): Promise<string> {
    const id = randomUUID();
    await this.database.pool.query("INSERT INTO api_usage (id,user_id,endpoint) VALUES ($1,$2,'/v1/classify')", [id, userId]);
    return id;
  }

  async finishRequest(id: string, status: number, duration: number, decision?: { tier: Tier; score: number; model: string }): Promise<void> {
    await this.database.pool.query(`UPDATE api_usage SET status=$2,duration_ms=$3,tier=$4,score=$5,model=$6
      WHERE id=$1 AND status IS NULL`, [id, status, duration, decision?.tier, decision?.score, decision?.model]);
  }

  async recordDemo(attempt: DemoAttempt | DemoInference, status: number): Promise<void> {
    const { id, userId, createdAt, durationMs } = attempt;
    const inference = 'probabilities' in attempt ? attempt : undefined;
    const decision = inference && demoHistoryEntry(inference);
    // The relay and browser can deliver the same receipt, including after a reload or lost acknowledgement.
    await this.database.pool.query(`INSERT INTO api_usage (id,user_id,endpoint,created_at,duration_ms,status,tier,score,model,input_tokens,output_tokens)
      VALUES ($1,$2,'/v1/demo/inference',$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
    [id, userId, createdAt, durationMs, status, decision?.tier, decision?.score, decision?.model, inference?.inputTokens, inference?.outputTokens]);
  }

  async usage(userId: string): Promise<PortalUsage> {
    const { rows } = await this.database.pool.query<StoredUsageRow>(
      `SELECT
         COALESCE((SELECT SUM(requests)::int FROM api_user_endpoint_stats
           WHERE user_id=$1 AND NOT (method='GET' AND endpoint='/v1/usage/me')), 0) AS requests,
         (count(*) FILTER (WHERE status BETWEEN 200 AND 299))::int AS successful,
         GREATEST(
           max(created_at),
           (SELECT max(last_requested_at) FROM api_user_endpoint_stats
             WHERE user_id=$1 AND NOT (method='GET' AND endpoint='/v1/usage/me'))
         ) AS "lastRequest",
         (SELECT json_build_object('remaining', trim_scale(remaining_credits)::text, 'checkedAt', checked_at)
            FROM netlify_credit_checks ORDER BY checked_at DESC LIMIT 1) AS "netlifyCreditBalance"
       FROM api_usage WHERE user_id=$1`,
      [userId],
    );
    const row = rows[0];
    const quota = buildUsageQuota(row.requests);
    return {
      ...quota,
      warning: quota.limitExceeded ? portalText.freeLimitWarning : null,
      successful: row.successful,
      lastRequest: row.lastRequest,
      netlifyCreditBalance: row.netlifyCreditBalance,
    };
  }

  async history(userId: string): Promise<PortalHistory[]> {
    const { rows } = await this.database.pool.query<PortalHistory>(`SELECT id,tier,score,model,created_at AS "createdAt"
      FROM api_usage WHERE user_id=$1 AND tier IS NOT NULL AND deleted_at IS NULL ORDER BY created_at DESC,id LIMIT 50`, [userId]);
    return rows;
  }

  async updateClassification(
    userId: string,
    id: string,
    update: ClassificationUpdate,
  ): Promise<{ status: 200; record: PortalHistory } | { status: 403 | 404 }> {
    return this.database.transaction(async client => {
      const { rows: [existing] } = await client.query<{ user_id: string }>(
        'SELECT user_id FROM api_usage WHERE id=$1 AND tier IS NOT NULL AND deleted_at IS NULL FOR UPDATE',
        [id],
      );
      if (!existing) return { status: 404 };
      if (existing.user_id !== userId) return { status: 403 };
      const { rows: [record] } = await client.query<PortalHistory>(
        `UPDATE api_usage SET tier=$3
         WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL
         RETURNING id,tier,score,model,created_at AS "createdAt"`,
        [id, userId, update.tier],
      );
      return { status: 200, record };
    });
  }

  async deleteClassification(userId: string, id: string): Promise<204 | 403 | 404> {
    return this.database.transaction(async client => {
      const { rows: [existing] } = await client.query<{ user_id: string }>(
        'SELECT user_id FROM api_usage WHERE id=$1 AND tier IS NOT NULL AND deleted_at IS NULL FOR UPDATE',
        [id],
      );
      if (!existing) return 404;
      if (existing.user_id !== userId) return 403;
      await client.query(
        'UPDATE api_usage SET deleted_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL',
        [id, userId],
      );
      return 204;
    });
  }

  async recordEndpointHit(method: string, endpoint: string, userId?: string): Promise<number | undefined> {
    const endpointSql = `INSERT INTO api_endpoint_stats (method, endpoint, requests, last_requested_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (method, endpoint)
       DO UPDATE SET requests = api_endpoint_stats.requests + 1, last_requested_at = now()`;
    if (!userId) {
      await this.database.pool.query(endpointSql, [method, endpoint]);
      return undefined;
    }
    return this.database.transaction(async client => {
      // Serialize concurrent quota updates per user so committed totals never race across different routes.
      await client.query('SELECT pg_advisory_xact_lock(734182005, hashtext($1))', [userId]);
      await client.query(endpointSql, [method, endpoint]);
      await client.query(
        `INSERT INTO api_user_endpoint_stats (user_id, method, endpoint, requests, last_requested_at)
         VALUES ($1, $2, $3, 1, now())
         ON CONFLICT (user_id, method, endpoint)
         DO UPDATE SET requests = api_user_endpoint_stats.requests + 1, last_requested_at = now()`,
        [userId, method, endpoint],
      );
      const { rows: [total] } = await client.query<{ requests: number }>(
        `SELECT COALESCE(SUM(requests), 0)::int AS requests FROM api_user_endpoint_stats
         WHERE user_id=$1 AND NOT (method='GET' AND endpoint='/v1/usage/me')`,
        [userId],
      );
      return total.requests;
    });
  }

  async dashboard(): Promise<PortalDashboard> {
    const [{ rows: users }, { rows: endpoints }] = await Promise.all([
      this.database.pool.query<PortalDashboard['users'][number]>(`SELECT u.id,u.email,u.role,u.created_at AS "createdAt",
        COALESCE(SUM(s.requests), 0)::int AS requests FROM app_users u
        LEFT JOIN api_user_endpoint_stats s ON s.user_id=u.id AND NOT (s.method='GET' AND s.endpoint='/v1/usage/me')
        GROUP BY u.id ORDER BY u.created_at DESC,u.id`),
      this.database.pool.query<EndpointStat>(`SELECT method, endpoint, requests
        FROM api_endpoint_stats
        WHERE NOT (method='GET' AND endpoint='/v1/usage/me')
        ORDER BY requests DESC, endpoint ASC, method ASC`),
    ]);
    return { users, endpoints };
  }

  // The archived connected application also supported account management.
  // Serialize its mutations so concurrent requests cannot remove the last administrator.
  async manageUser(actor: string, target: string, action: PortalRole | 'delete'): Promise<number> {
    return this.database.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(734182005, 3)');
      const { rows: [current] } = await client.query('SELECT role FROM app_users WHERE id=$1', [actor]);
      if (current?.role !== 'admin') return 403;
      const { rows: [user] } = await client.query('SELECT role FROM app_users WHERE id::text=$1 FOR UPDATE', [target]);
      if (!user) return 404;
      if (action === 'delete' && actor === target) return 409;
      if (user.role === 'admin' && action !== 'admin') {
        const { rows: [admins] } = await client.query("SELECT count(*)::int AS count FROM app_users WHERE role='admin'");
        if (admins.count < 2) return 409;
      }
      if (action === 'delete') await client.query('DELETE FROM app_users WHERE id=$1', [target]);
      else await client.query('UPDATE app_users SET role=$2 WHERE id=$1', [target, action]);
      return 204;
    });
  }
}
