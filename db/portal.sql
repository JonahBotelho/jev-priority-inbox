-- Private portal data. Resend's public inbox never reads from these tables.
SELECT pg_advisory_xact_lock(734182005, 2);

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS app_sessions_expiry ON app_sessions (expires_at);

-- Installations without an externally managed APP_JWT_SECRET share one private signing key.
CREATE TABLE IF NOT EXISTS app_portal_signing_key (
  singleton boolean PRIMARY KEY CHECK (singleton),
  key_bytes bytea NOT NULL CHECK (octet_length(key_bytes) = 32)
);
REVOKE ALL ON app_portal_signing_key FROM PUBLIC;

-- One row per valid classification attempt. A successful row is also its private history entry.
CREATE TABLE IF NOT EXISTS api_usage (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  status integer,
  duration_ms integer,
  tier text CHECK (tier IN ('Emergency','Urgent','Routine')),
  score integer,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_usage_user_time ON api_usage (user_id, created_at DESC);

-- Native TypeSafe responses include token usage. Historical receipts keep their original counts.
ALTER TABLE api_usage ADD COLUMN IF NOT EXISTS input_tokens integer,
                      ADD COLUMN IF NOT EXISTS output_tokens integer,
                      ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- A maintainer records the balance from the team's Netlify billing dashboard at the time of observation.
CREATE TABLE IF NOT EXISTS netlify_credit_checks (
  checked_at timestamptz PRIMARY KEY DEFAULT now() CHECK (isfinite(checked_at)),
  remaining_credits numeric NOT NULL CHECK (remaining_credits >= 0 AND remaining_credits < 'Infinity'::numeric)
);

-- Server-side request counters grouped by HTTP method and normalized Express route path.
CREATE TABLE IF NOT EXISTS api_endpoint_stats (
  method text NOT NULL CHECK (method IN ('GET','POST','PUT','PATCH','DELETE')),
  endpoint text NOT NULL,
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  last_requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (method, endpoint)
);

-- Seed historical classification totals once when upgrading an existing database.
INSERT INTO api_endpoint_stats (method, endpoint, requests, last_requested_at)
SELECT 'POST', endpoint, count(*)::int, max(created_at)
FROM api_usage
WHERE NOT EXISTS (SELECT 1 FROM api_endpoint_stats)
GROUP BY endpoint
ON CONFLICT (method, endpoint) DO NOTHING;

-- Per-user request counters across all tracked authenticated functional API endpoints.
CREATE TABLE IF NOT EXISTS api_user_endpoint_stats (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('GET','POST','PUT','PATCH','DELETE')),
  endpoint text NOT NULL,
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  last_requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, method, endpoint)
);

-- Seed historical per-user classification totals once when upgrading an existing database.
INSERT INTO api_user_endpoint_stats (user_id, method, endpoint, requests, last_requested_at)
SELECT user_id, 'POST', endpoint, count(*)::int, max(created_at)
FROM api_usage
WHERE NOT EXISTS (SELECT 1 FROM api_user_endpoint_stats)
GROUP BY user_id, endpoint
ON CONFLICT (user_id, method, endpoint) DO NOTHING;
