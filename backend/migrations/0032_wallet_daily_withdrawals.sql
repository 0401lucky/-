-- +goose Up
CREATE TABLE IF NOT EXISTS wallet_daily_withdrawals (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  withdraw_date DATE NOT NULL,
  used_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, withdraw_date),
  CHECK (user_id > 0),
  CHECK (used_count >= 0)
);

-- +goose Down
DROP TABLE IF EXISTS wallet_daily_withdrawals;
