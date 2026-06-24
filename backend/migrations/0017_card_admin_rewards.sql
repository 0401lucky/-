-- +goose Up
CREATE TABLE IF NOT EXISTS card_album_rewards (
  album_id TEXT PRIMARY KEY,
  reward_points BIGINT NOT NULL,
  raw_reward JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at_ms BIGINT NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (album_id <> ''),
  CHECK (reward_points >= 0),
  CHECK (jsonb_typeof(raw_reward) = 'object'),
  CHECK (updated_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS card_tier_rewards (
  reward_type TEXT PRIMARY KEY,
  reward_points BIGINT NOT NULL,
  raw_reward JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at_ms BIGINT NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reward_type IN ('common', 'rare', 'epic', 'legendary', 'legendary_rare', 'full_set')),
  CHECK (reward_points >= 0),
  CHECK (jsonb_typeof(raw_reward) = 'object'),
  CHECK (updated_at_ms >= 0)
);

-- +goose Down
DROP TABLE IF EXISTS card_tier_rewards;
DROP TABLE IF EXISTS card_album_rewards;
