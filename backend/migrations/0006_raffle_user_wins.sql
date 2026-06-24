-- +goose Up
CREATE TABLE IF NOT EXISTS user_raffle_wins (
  entry_id TEXT PRIMARY KEY,
  raffle_id TEXT NOT NULL,
  user_id BIGINT NOT NULL,
  username TEXT NOT NULL,
  raffle_title TEXT NOT NULL,
  prize_id TEXT NOT NULL,
  prize_name TEXT NOT NULL,
  points BIGINT NOT NULL,
  reward_message TEXT NOT NULL DEFAULT '',
  delivered_at_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id > 0),
  CHECK (points > 0),
  CHECK (delivered_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_user_raffle_wins_user_delivered
  ON user_raffle_wins(user_id, delivered_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_user_raffle_wins_raffle
  ON user_raffle_wins(raffle_id);

-- +goose Down
DROP TABLE IF EXISTS user_raffle_wins;
