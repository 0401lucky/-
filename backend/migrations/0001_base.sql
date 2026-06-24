-- +goose Up
CREATE TABLE IF NOT EXISTS schema_migrations_marker (
  id BIGSERIAL PRIMARY KEY,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS point_accounts (
  user_id BIGINT PRIMARY KEY REFERENCES users(id),
  balance BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (balance >= 0)
);

CREATE TABLE IF NOT EXISTS point_ledger (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  amount BIGINT NOT NULL,
  source TEXT NOT NULL,
  description TEXT NOT NULL,
  balance_after BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_point_ledger_user_created_at
  ON point_ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS daily_game_points (
  user_id BIGINT NOT NULL REFERENCES users(id),
  stat_date DATE NOT NULL,
  earned_points BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, stat_date)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  result_json JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
  ON idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  game_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_user_game
  ON game_sessions(user_id, game_type, expires_at);

CREATE TABLE IF NOT EXISTS active_game_sessions (
  user_id BIGINT NOT NULL REFERENCES users(id),
  game_type TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, game_type)
);

CREATE TABLE IF NOT EXISTS game_records (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  difficulty TEXT,
  score BIGINT NOT NULL DEFAULT 0,
  points_earned BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_records_user_game_created_at
  ON game_records(user_id, game_type, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_run_after
  ON jobs(status, run_after);

-- +goose Down
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS game_records;
DROP TABLE IF EXISTS active_game_sessions;
DROP TABLE IF EXISTS game_sessions;
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS daily_game_points;
DROP TABLE IF EXISTS point_ledger;
DROP TABLE IF EXISTS point_accounts;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS schema_migrations_marker;
