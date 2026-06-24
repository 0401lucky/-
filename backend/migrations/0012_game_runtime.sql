-- +goose Up
CREATE TABLE IF NOT EXISTS game_cooldowns (
  user_id BIGINT NOT NULL REFERENCES users(id),
  game_type TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_type)
);

CREATE INDEX IF NOT EXISTS idx_game_cooldowns_expires_at
  ON game_cooldowns(expires_at);

CREATE TABLE IF NOT EXISTS game_daily_stats (
  user_id BIGINT NOT NULL REFERENCES users(id),
  stat_date DATE NOT NULL,
  games_played BIGINT NOT NULL DEFAULT 0,
  total_score BIGINT NOT NULL DEFAULT 0,
  points_earned BIGINT NOT NULL DEFAULT 0,
  last_game_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, stat_date)
);

-- +goose Down
DROP TABLE IF EXISTS game_daily_stats;
DROP TABLE IF EXISTS game_cooldowns;
