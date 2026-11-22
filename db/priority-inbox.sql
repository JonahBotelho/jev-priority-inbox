-- The API runs this migration in one transaction, including during overlapping deploys.
SELECT pg_advisory_xact_lock(734182005, 1);

CREATE TABLE IF NOT EXISTS jev_priority_messages (
  id text PRIMARY KEY,
  mailbox text NOT NULL,
  provider_id text NOT NULL,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','complete','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT '-infinity',
  claim_token uuid,
  lease_until timestamptz,
  subject text,
  preview text,
  probabilities jsonb,
  tier text CHECK (tier IN ('Emergency','Urgent','Routine')),
  score double precision,
  handled boolean NOT NULL DEFAULT false,
  UNIQUE (mailbox, provider_id)
);

CREATE INDEX IF NOT EXISTS jev_priority_queue
  ON jev_priority_messages (mailbox, created_at, id) WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS jev_priority_cards
  ON jev_priority_messages (mailbox, tier, score DESC, received_at DESC, id)
  WHERE status='complete' AND NOT handled AND probabilities IS NOT NULL;
