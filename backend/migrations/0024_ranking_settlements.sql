-- +goose Up
CREATE TABLE IF NOT EXISTS ranking_settlements (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  period_start_ms BIGINT NOT NULL,
  period_end_ms BIGINT NOT NULL,
  period_label TEXT NOT NULL,
  status TEXT NOT NULL,
  reward_policy JSONB NOT NULL,
  total_participants BIGINT NOT NULL DEFAULT 0,
  rewards JSONB NOT NULL,
  summary JSONB NOT NULL,
  created_at_ms BIGINT NOT NULL,
  settled_at_ms BIGINT NOT NULL,
  retry_count BIGINT NOT NULL DEFAULT 0,
  triggered_by JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period IN ('weekly', 'monthly')),
  CHECK (status IN ('success', 'partial', 'failed')),
  CHECK (period_start_ms > 0),
  CHECK (period_end_ms > period_start_ms),
  CHECK (total_participants >= 0),
  CHECK (created_at_ms > 0),
  CHECK (settled_at_ms > 0),
  CHECK (retry_count >= 0),
  UNIQUE (period, period_start_ms, period_end_ms)
);

CREATE INDEX IF NOT EXISTS idx_ranking_settlements_period_end
  ON ranking_settlements(period, period_end_ms DESC);

CREATE TABLE IF NOT EXISTS ranking_reward_claims (
  period TEXT NOT NULL,
  period_start_ms BIGINT NOT NULL,
  period_end_ms BIGINT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  processed_at_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period IN ('weekly', 'monthly')),
  CHECK (period_start_ms > 0),
  CHECK (period_end_ms > period_start_ms),
  CHECK (processed_at_ms > 0),
  PRIMARY KEY (period, period_start_ms, period_end_ms, user_id)
);

-- +goose Down
DROP TABLE IF EXISTS ranking_reward_claims;
DROP TABLE IF EXISTS ranking_settlements;
