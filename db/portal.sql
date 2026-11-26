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
                      ADD COLUMN IF NOT EXISTS output_tokens integer;

-- A maintainer records the balance from the team's Netlify billing dashboard at the time of observation.
CREATE TABLE IF NOT EXISTS netlify_credit_checks (
  checked_at timestamptz PRIMARY KEY DEFAULT now() CHECK (isfinite(checked_at)),
  remaining_credits numeric NOT NULL CHECK (remaining_credits >= 0 AND remaining_credits < 'Infinity'::numeric)
);
