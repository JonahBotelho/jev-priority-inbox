// Portal accounts, revocable sessions and per-user classification receipts in the existing Neon database.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { demoHistoryEntry, type DemoAttempt, type DemoInference, type PortalDashboard, type PortalHistory,
  type PortalRole, type PortalUsage, type PortalUser } from '../../shared/portal.js';
import type { Tier } from '../../shared/types.js';
import type { PostgresInbox } from './PostgresInbox.js';

export interface PortalSession { id: string; expiresAt: Date }
interface StoredUser extends PortalUser { password_hash: string }

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

  async sessionUser(sessionId: string, userId: string): Promise<PortalUser | undefined> {
    const { rows } = await this.database.pool.query<PortalUser>(`SELECT u.id,u.email,u.role FROM app_sessions s
      JOIN app_users u ON u.id=s.user_id WHERE s.id=$1 AND u.id=$2 AND s.expires_at > now()`, [sessionId, userId]);
    return rows[0];
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
    const { rows } = await this.database.pool.query<PortalUsage>(`SELECT count(*)::int AS requests,
      (count(*) FILTER (WHERE status BETWEEN 200 AND 299))::int AS successful, max(created_at) AS "lastRequest",
      (SELECT json_build_object('remaining', trim_scale(remaining_credits)::text, 'checkedAt', checked_at)
         FROM netlify_credit_checks ORDER BY checked_at DESC LIMIT 1) AS "netlifyCreditBalance"
      FROM api_usage WHERE user_id=$1`, [userId]);
    return rows[0];
  }

  async history(userId: string): Promise<PortalHistory[]> {
    const { rows } = await this.database.pool.query<PortalHistory>(`SELECT id,tier,score,model,created_at AS "createdAt"
      FROM api_usage WHERE user_id=$1 AND tier IS NOT NULL ORDER BY created_at DESC,id LIMIT 50`, [userId]);
    return rows;
  }

  async dashboard(): Promise<PortalDashboard> {
    const { rows: users } = await this.database.pool.query<PortalDashboard['users'][number]>(`SELECT u.id,u.email,u.role,u.created_at AS "createdAt",
      count(a.id)::int AS requests FROM app_users u LEFT JOIN api_usage a ON a.user_id=u.id
      GROUP BY u.id ORDER BY u.created_at DESC,u.id`);
    return { users };
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
