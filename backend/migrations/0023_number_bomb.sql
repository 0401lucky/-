-- +goose Up
CREATE TABLE IF NOT EXISTS number_bomb_draws (
  draw_date DATE PRIMARY KEY,
  system_number INTEGER NOT NULL,
  processed BIGINT NOT NULL DEFAULT 0,
  won BIGINT NOT NULL DEFAULT 0,
  lost BIGINT NOT NULL DEFAULT 0,
  skipped BIGINT NOT NULL DEFAULT 0,
  settled_at_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (system_number >= 0 AND system_number <= 9),
  CHECK (processed >= 0),
  CHECK (won >= 0),
  CHECK (lost >= 0),
  CHECK (skipped >= 0),
  CHECK (settled_at_ms IS NULL OR settled_at_ms > 0)
);

CREATE TABLE IF NOT EXISTS number_bomb_bets (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  bet_date DATE NOT NULL,
  selected_number INTEGER NOT NULL,
  multiplier INTEGER NOT NULL,
  ticket_cost BIGINT NOT NULL,
  status TEXT NOT NULL,
  system_number INTEGER,
  reward_points BIGINT,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  settled_at_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, bet_date),
  CHECK (id <> ''),
  CHECK (user_id > 0),
  CHECK (username <> ''),
  CHECK (selected_number >= 0 AND selected_number <= 9),
  CHECK (multiplier IN (1, 2, 5, 10)),
  CHECK (ticket_cost > 0),
  CHECK (status IN ('pending', 'won', 'lost', 'cancelled')),
  CHECK (system_number IS NULL OR (system_number >= 0 AND system_number <= 9)),
  CHECK (reward_points IS NULL OR reward_points >= 0),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms >= created_at_ms),
  CHECK (settled_at_ms IS NULL OR settled_at_ms >= created_at_ms)
);

CREATE INDEX IF NOT EXISTS idx_number_bomb_bets_date_status
  ON number_bomb_bets(bet_date DESC, status, user_id);

CREATE INDEX IF NOT EXISTS idx_number_bomb_bets_user_date
  ON number_bomb_bets(user_id, bet_date DESC);

-- +goose Down
DROP TABLE IF EXISTS number_bomb_bets;
DROP TABLE IF EXISTS number_bomb_draws;
