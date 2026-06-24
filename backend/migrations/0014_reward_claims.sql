-- +goose Up
CREATE TABLE IF NOT EXISTS reward_batches (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  target_mode TEXT NOT NULL,
  target_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  status TEXT NOT NULL,
  total_targets BIGINT NOT NULL DEFAULT 0,
  distributed_count BIGINT NOT NULL DEFAULT 0,
  claimed_count BIGINT NOT NULL DEFAULT 0,
  failed_claim_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type IN ('points', 'quota')),
  CHECK (amount > 0),
  CHECK (target_mode IN ('all', 'selected')),
  CHECK (jsonb_typeof(target_user_ids) = 'array'),
  CHECK (created_at_ms > 0),
  CHECK (status IN ('distributing', 'completed', 'failed')),
  CHECK (total_targets >= 0),
  CHECK (distributed_count >= 0),
  CHECK (claimed_count >= 0),
  CHECK (failed_claim_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_reward_batches_created_at
  ON reward_batches(created_at_ms DESC);

CREATE TABLE IF NOT EXISTS reward_claims (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  notification_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  status TEXT NOT NULL,
  claimed_at_ms BIGINT,
  fail_reason TEXT,
  retry_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id > 0),
  CHECK (type IN ('points', 'quota')),
  CHECK (amount > 0),
  CHECK (status IN ('pending', 'claimed', 'failed')),
  CHECK (claimed_at_ms IS NULL OR claimed_at_ms > 0),
  CHECK (retry_count >= 0),
  UNIQUE (batch_id, user_id),
  UNIQUE (notification_id)
);

CREATE INDEX IF NOT EXISTS idx_reward_claims_user_status
  ON reward_claims(user_id, status);

CREATE INDEX IF NOT EXISTS idx_reward_claims_batch_status
  ON reward_claims(batch_id, status);

-- +goose Down
DROP TABLE IF EXISTS reward_claims;
DROP TABLE IF EXISTS reward_batches;
