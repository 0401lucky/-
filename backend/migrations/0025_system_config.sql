-- +goose Up
CREATE TABLE IF NOT EXISTS system_config (
  id TEXT PRIMARY KEY,
  daily_points_limit BIGINT NOT NULL DEFAULT 5000,
  updated_at_ms BIGINT NOT NULL,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id = 'system'),
  CHECK (daily_points_limit BETWEEN 100 AND 100000),
  CHECK (updated_at_ms > 0)
);

INSERT INTO system_config (id, daily_points_limit, updated_at_ms, updated_by)
VALUES ('system', 5000, 1, NULL)
ON CONFLICT (id) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS system_config;
