-- +goose Up
CREATE TABLE IF NOT EXISTS raffle_delivery_jobs (
  id BIGSERIAL PRIMARY KEY,
  raffle_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'draw',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts BIGINT NOT NULL DEFAULT 0,
  available_at_ms BIGINT NOT NULL,
  locked_at_ms BIGINT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reason IN ('draw', 'retry')),
  CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  CHECK (attempts >= 0),
  CHECK (available_at_ms > 0),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_raffle_delivery_jobs_active_unique
  ON raffle_delivery_jobs(raffle_id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_raffle_delivery_jobs_claim
  ON raffle_delivery_jobs(status, available_at_ms, id);

-- +goose Down
DROP TABLE IF EXISTS raffle_delivery_jobs;
