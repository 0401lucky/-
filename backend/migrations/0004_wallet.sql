-- +goose Up
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  points_delta BIGINT NOT NULL,
  dollars_delta NUMERIC(12, 2) NOT NULL,
  requested_points BIGINT,
  requested_dollars NUMERIC(12, 2),
  fee_points BIGINT,
  net_points BIGINT,
  message TEXT NOT NULL,
  new_api_quota BIGINT,
  new_api_used_quota BIGINT,
  new_api_balance_dollars NUMERIC(12, 2),
  new_api_balance_whole_dollars BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (operation IN ('withdraw', 'topup')),
  CHECK (status IN ('pending', 'success', 'failed', 'uncertain')),
  CHECK (requested_points IS NULL OR requested_points > 0),
  CHECK (requested_dollars IS NULL OR requested_dollars > 0),
  CHECK (fee_points IS NULL OR fee_points >= 0),
  CHECK (net_points IS NULL OR net_points >= 0),
  CHECK (new_api_quota IS NULL OR new_api_quota >= 0),
  CHECK (new_api_used_quota IS NULL OR new_api_used_quota >= 0),
  CHECK (new_api_balance_dollars IS NULL OR new_api_balance_dollars >= 0),
  CHECK (new_api_balance_whole_dollars IS NULL OR new_api_balance_whole_dollars >= 0)
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created_at
  ON wallet_transactions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_status_updated_at
  ON wallet_transactions(status, updated_at DESC);

-- +goose Down
DROP TABLE IF EXISTS wallet_transactions;
