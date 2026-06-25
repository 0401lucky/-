-- +goose Up
CREATE TABLE IF NOT EXISTS lottery_configs (
  id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  mode TEXT NOT NULL DEFAULT 'points',
  daily_direct_limit BIGINT NOT NULL DEFAULT 2000,
  daily_spin_limit BIGINT NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (mode IN ('code', 'direct', 'hybrid', 'points')),
  CHECK (daily_direct_limit >= 0),
  CHECK (daily_spin_limit >= 1)
);

CREATE TABLE IF NOT EXISTS lottery_tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  value BIGINT NOT NULL,
  probability DOUBLE PRECISION NOT NULL,
  color TEXT NOT NULL,
  codes_count BIGINT NOT NULL DEFAULT 0,
  used_count BIGINT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (name <> ''),
  CHECK (value >= 0),
  CHECK (probability >= 0),
  CHECK (codes_count >= 0),
  CHECK (used_count >= 0),
  CHECK (used_count <= codes_count OR codes_count = 0)
);

CREATE INDEX IF NOT EXISTS idx_lottery_tiers_sort
  ON lottery_tiers(sort_order, id);

CREATE TABLE IF NOT EXISTS lottery_records (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  tier_id TEXT NOT NULL,
  tier_name TEXT NOT NULL,
  tier_value BIGINT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  direct_credit BOOLEAN NOT NULL DEFAULT false,
  credited_quota BIGINT,
  points_awarded BIGINT,
  created_at_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (user_id > 0),
  CHECK (username <> ''),
  CHECK (tier_id <> ''),
  CHECK (tier_name <> ''),
  CHECK (tier_value >= 0),
  CHECK (credited_quota IS NULL OR credited_quota >= 0),
  CHECK (points_awarded IS NULL OR points_awarded >= 0),
  CHECK (created_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_lottery_records_created
  ON lottery_records(created_at_ms DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_lottery_records_user_created
  ON lottery_records(user_id, created_at_ms DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_lottery_records_direct_created
  ON lottery_records(created_at_ms DESC)
  WHERE direct_credit = true;

CREATE TABLE IF NOT EXISTS lottery_daily_spins (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spin_date DATE NOT NULL,
  used_count BIGINT NOT NULL DEFAULT 0,
  daily_free_claimed BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, spin_date),
  CHECK (user_id > 0),
  CHECK (used_count >= 0)
);

-- +goose Down
DROP TABLE IF EXISTS lottery_daily_spins;
DROP TABLE IF EXISTS lottery_records;
DROP TABLE IF EXISTS lottery_tiers;
DROP TABLE IF EXISTS lottery_configs;
