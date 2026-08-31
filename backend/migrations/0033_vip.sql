-- +goose Up
CREATE TABLE IF NOT EXISTS vip_memberships (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id > 0)
);

CREATE INDEX IF NOT EXISTS idx_vip_memberships_expires_at
  ON vip_memberships(expires_at DESC);

CREATE TABLE IF NOT EXISTS vip_purchases (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points_cost BIGINT NOT NULL,
  days BIGINT NOT NULL,
  expires_at_before TIMESTAMPTZ,
  expires_at_after TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (user_id > 0),
  CHECK (points_cost > 0),
  CHECK (days > 0)
);

CREATE INDEX IF NOT EXISTS idx_vip_purchases_user_created_at
  ON vip_purchases(user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS vip_purchases;
DROP TABLE IF EXISTS vip_memberships;
