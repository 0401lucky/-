-- +goose Up
CREATE TABLE IF NOT EXISTS admin_alerts (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_key TEXT UNIQUE,
  occurred_at_ms BIGINT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at_ms BIGINT,
  resolved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (level IN ('info', 'warning', 'critical')),
  CHECK (occurred_at_ms > 0),
  CHECK (resolved = FALSE OR resolved_at_ms IS NOT NULL),
  CHECK (jsonb_typeof(tags) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_admin_alerts_active
  ON admin_alerts(level, occurred_at_ms DESC)
  WHERE resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_admin_alerts_history
  ON admin_alerts(occurred_at_ms DESC);

CREATE TABLE IF NOT EXISTS admin_alert_point_baselines (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  points BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS admin_alert_point_baselines;
DROP TABLE IF EXISTS admin_alerts;
