-- +goose Up
CREATE TABLE IF NOT EXISTS card_user_states (
  user_id BIGINT PRIMARY KEY REFERENCES users(id),
  inventory JSONB NOT NULL DEFAULT '[]'::jsonb,
  fragments BIGINT NOT NULL DEFAULT 0,
  pity_rare BIGINT NOT NULL DEFAULT 0,
  pity_epic BIGINT NOT NULL DEFAULT 0,
  pity_legendary BIGINT NOT NULL DEFAULT 0,
  pity_legendary_rare BIGINT NOT NULL DEFAULT 0,
  draws_available BIGINT NOT NULL DEFAULT 1,
  collection_rewards JSONB NOT NULL DEFAULT '[]'::jsonb,
  recent_draws JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(inventory) = 'array'),
  CHECK (fragments >= 0),
  CHECK (pity_rare >= 0),
  CHECK (pity_epic >= 0),
  CHECK (pity_legendary >= 0),
  CHECK (pity_legendary_rare >= 0),
  CHECK (draws_available >= 0),
  CHECK (jsonb_typeof(collection_rewards) = 'array'),
  CHECK (jsonb_typeof(recent_draws) = 'array'),
  CHECK (jsonb_typeof(raw_state) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_card_user_states_updated_at
  ON card_user_states(updated_at DESC);

CREATE TABLE IF NOT EXISTS card_rules (
  id TEXT PRIMARY KEY,
  rarity_probabilities JSONB NOT NULL,
  pity_thresholds JSONB NOT NULL,
  card_draw_price BIGINT NOT NULL,
  fragment_values JSONB NOT NULL,
  exchange_prices JSONB NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at_ms BIGINT NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (jsonb_typeof(rarity_probabilities) = 'object'),
  CHECK (jsonb_typeof(pity_thresholds) = 'object'),
  CHECK (card_draw_price > 0),
  CHECK (jsonb_typeof(fragment_values) = 'object'),
  CHECK (jsonb_typeof(exchange_prices) = 'object'),
  CHECK (jsonb_typeof(config_json) = 'object'),
  CHECK (updated_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS card_draw_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  draw_group_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  rarity TEXT NOT NULL,
  is_duplicate BOOLEAN NOT NULL,
  fragments_added BIGINT NOT NULL DEFAULT 0,
  created_at_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (draw_group_id <> ''),
  CHECK (card_id <> ''),
  CHECK (rarity IN ('common', 'rare', 'epic', 'legendary', 'legendary_rare')),
  CHECK (fragments_added >= 0),
  CHECK (created_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_card_draw_logs_user_created
  ON card_draw_logs(user_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS card_reward_claims (
  user_id BIGINT NOT NULL REFERENCES users(id),
  album_id TEXT NOT NULL,
  reward_type TEXT NOT NULL,
  points_awarded BIGINT NOT NULL,
  claimed_at_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, album_id, reward_type),
  CHECK (album_id <> ''),
  CHECK (reward_type IN ('common', 'rare', 'epic', 'legendary', 'legendary_rare', 'full_set')),
  CHECK (points_awarded > 0),
  CHECK (claimed_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_card_reward_claims_claimed_at
  ON card_reward_claims(claimed_at_ms DESC);

-- +goose Down
DROP TABLE IF EXISTS card_reward_claims;
DROP TABLE IF EXISTS card_draw_logs;
DROP TABLE IF EXISTS card_rules;
DROP TABLE IF EXISTS card_user_states;
