-- +goose Up
CREATE TABLE IF NOT EXISTS eco_states (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pending BIGINT NOT NULL DEFAULT 0,
  spawn_leftover_ms BIGINT NOT NULL DEFAULT 0,
  auto_leftover_ms BIGINT NOT NULL DEFAULT 0,
  point_buffer BIGINT NOT NULL DEFAULT 0,
  lucky_generations_remaining BIGINT NOT NULL DEFAULT 0,
  glove_uses_remaining BIGINT NOT NULL DEFAULT 0,
  daily_trash_date DATE,
  daily_trash_points BIGINT NOT NULL DEFAULT 0,
  exp BIGINT NOT NULL DEFAULT 0,
  lifetime_cleared BIGINT NOT NULL DEFAULT 0,
  lifetime_points BIGINT NOT NULL DEFAULT 0,
  points_snapshot BIGINT NOT NULL DEFAULT 0,
  last_tick_at_ms BIGINT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  raw_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (pending >= 0),
  CHECK (spawn_leftover_ms >= 0),
  CHECK (auto_leftover_ms >= 0),
  CHECK (point_buffer >= 0),
  CHECK (lucky_generations_remaining >= 0),
  CHECK (glove_uses_remaining >= 0),
  CHECK (daily_trash_points >= 0),
  CHECK (exp >= 0),
  CHECK (lifetime_cleared >= 0),
  CHECK (lifetime_points >= 0),
  CHECK (points_snapshot >= 0),
  CHECK (last_tick_at_ms > 0),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms > 0)
);

CREATE TABLE IF NOT EXISTS eco_user_upgrades (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  upgrade_key TEXT NOT NULL,
  level BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, upgrade_key),
  CHECK (upgrade_key IN ('spawn', 'storage', 'value', 'auto')),
  CHECK (level >= 0)
);

CREATE TABLE IF NOT EXISTS eco_prize_inventory (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prize_key TEXT NOT NULL,
  inventory_count BIGINT NOT NULL DEFAULT 0,
  limited_count BIGINT NOT NULL DEFAULT 0,
  lifetime_claim_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, prize_key),
  CHECK (prize_key IN ('diamond', 'coin', 'necklace', 'trophy', 'photo')),
  CHECK (inventory_count >= 0),
  CHECK (limited_count >= 0),
  CHECK (lifetime_claim_count >= 0)
);

CREATE TABLE IF NOT EXISTS eco_prize_lots (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prize_key TEXT NOT NULL,
  acquired_at_ms BIGINT NOT NULL,
  available_at_ms BIGINT NOT NULL,
  limited BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL,
  public_entry_id TEXT,
  publicly_listed_at_ms BIGINT,
  merchant_available_at_ms BIGINT,
  stolen_from_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  stolen_at_ms BIGINT,
  theft_id TEXT,
  black_market_available_at_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (prize_key IN ('diamond', 'coin', 'necklace', 'trophy', 'photo')),
  CHECK (source IN ('claim', 'stolen', 'restored')),
  CHECK (acquired_at_ms > 0),
  CHECK (available_at_ms > 0),
  CHECK (publicly_listed_at_ms IS NULL OR publicly_listed_at_ms > 0),
  CHECK (merchant_available_at_ms IS NULL OR merchant_available_at_ms > 0),
  CHECK (stolen_at_ms IS NULL OR stolen_at_ms > 0),
  CHECK (black_market_available_at_ms IS NULL OR black_market_available_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_eco_prize_lots_user_key
  ON eco_prize_lots(user_id, prize_key);

CREATE INDEX IF NOT EXISTS idx_eco_prize_lots_public_entry
  ON eco_prize_lots(public_entry_id)
  WHERE public_entry_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS eco_visible_prizes (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prize_key TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  limited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (prize_key IN ('diamond', 'coin', 'necklace', 'trophy', 'photo')),
  CHECK (created_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_eco_visible_prizes_user_created
  ON eco_visible_prizes(user_id, created_at_ms);

CREATE TABLE IF NOT EXISTS eco_item_purchases (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  purchase_date DATE NOT NULL,
  purchase_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_key, purchase_date),
  CHECK (item_key IN ('clear_truck', 'lucky_flashlight', 'recycle_glove')),
  CHECK (purchase_count >= 0)
);

CREATE TABLE IF NOT EXISTS eco_global_prize_stock (
  prize_key TEXT PRIMARY KEY,
  claimed_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (prize_key IN ('diamond', 'coin', 'necklace', 'trophy', 'photo')),
  CHECK (claimed_count >= 0)
);

CREATE TABLE IF NOT EXISTS eco_public_prizes (
  id TEXT PRIMARY KEY,
  prize_key TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_name TEXT NOT NULL,
  owner_avatar_url TEXT,
  owner_lot_id TEXT NOT NULL,
  public_at_ms BIGINT NOT NULL,
  merchant_available_at_ms BIGINT NOT NULL,
  status TEXT NOT NULL,
  thief_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  thief_name TEXT,
  theft_message TEXT,
  stolen_at_ms BIGINT,
  raw_entry JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (prize_key IN ('diamond', 'coin', 'necklace', 'trophy', 'photo')),
  CHECK (status IN ('listed', 'stolen')),
  CHECK (public_at_ms > 0),
  CHECK (merchant_available_at_ms > 0),
  CHECK (stolen_at_ms IS NULL OR stolen_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_eco_public_prizes_owner
  ON eco_public_prizes(owner_user_id, public_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_eco_public_prizes_status
  ON eco_public_prizes(status, public_at_ms DESC);

CREATE TABLE IF NOT EXISTS eco_thefts (
  id TEXT PRIMARY KEY,
  prize_key TEXT NOT NULL,
  original_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thief_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_entry_id TEXT NOT NULL,
  original_lot_id TEXT NOT NULL,
  thief_lot_id TEXT NOT NULL,
  stolen_at_ms BIGINT NOT NULL,
  next_check_at_ms BIGINT NOT NULL,
  black_market_available_at_ms BIGINT NOT NULL,
  message TEXT NOT NULL,
  resolved_at_ms BIGINT,
  outcome TEXT,
  raw_record JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (prize_key IN ('diamond', 'coin', 'necklace', 'trophy', 'photo')),
  CHECK (outcome IS NULL OR outcome IN ('caught', 'escaped')),
  CHECK (stolen_at_ms > 0),
  CHECK (next_check_at_ms > 0),
  CHECK (black_market_available_at_ms > 0),
  CHECK (resolved_at_ms IS NULL OR resolved_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_eco_thefts_thief_active
  ON eco_thefts(thief_user_id, resolved_at_ms);

CREATE INDEX IF NOT EXISTS idx_eco_thefts_next_check
  ON eco_thefts(next_check_at_ms)
  WHERE resolved_at_ms IS NULL;

CREATE TABLE IF NOT EXISTS eco_prize_claim_stats (
  stat_date DATE NOT NULL,
  prize_key TEXT NOT NULL,
  claim_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (stat_date, prize_key),
  CHECK (prize_key IN ('diamond', 'coin', 'necklace', 'trophy', 'photo', 'total')),
  CHECK (claim_count >= 0)
);

CREATE TABLE IF NOT EXISTS eco_trash_rankings (
  period TEXT NOT NULL,
  period_key TEXT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trash_cleared BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period, period_key, user_id),
  CHECK (period IN ('daily', 'weekly', 'monthly')),
  CHECK (trash_cleared >= 0)
);

CREATE INDEX IF NOT EXISTS idx_eco_trash_rankings_period_score
  ON eco_trash_rankings(period, period_key, trash_cleared DESC);

-- +goose Down
DROP TABLE IF EXISTS eco_trash_rankings;
DROP TABLE IF EXISTS eco_prize_claim_stats;
DROP TABLE IF EXISTS eco_thefts;
DROP TABLE IF EXISTS eco_public_prizes;
DROP TABLE IF EXISTS eco_global_prize_stock;
DROP TABLE IF EXISTS eco_item_purchases;
DROP TABLE IF EXISTS eco_visible_prizes;
DROP TABLE IF EXISTS eco_prize_lots;
DROP TABLE IF EXISTS eco_prize_inventory;
DROP TABLE IF EXISTS eco_user_upgrades;
DROP TABLE IF EXISTS eco_states;
