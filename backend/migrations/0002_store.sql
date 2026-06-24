-- +goose Up
CREATE TABLE IF NOT EXISTS store_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  category_id TEXT REFERENCES store_categories(id),
  points_cost BIGINT NOT NULL,
  value BIGINT NOT NULL,
  daily_limit BIGINT,
  total_stock BIGINT,
  purchase_count BIGINT NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (points_cost > 0),
  CHECK (value > 0),
  CHECK (daily_limit IS NULL OR daily_limit >= 0),
  CHECK (total_stock IS NULL OR total_stock >= 0),
  CHECK (purchase_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_store_items_enabled_sort
  ON store_items(enabled, sort_order, id);

CREATE TABLE IF NOT EXISTS store_daily_purchases (
  user_id BIGINT NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL REFERENCES store_items(id),
  stat_date DATE NOT NULL,
  purchase_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id, stat_date),
  CHECK (purchase_count >= 0)
);

CREATE TABLE IF NOT EXISTS exchange_logs (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  points_cost BIGINT NOT NULL,
  value BIGINT NOT NULL,
  type TEXT NOT NULL,
  quantity BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exchange_logs_user_created_at
  ON exchange_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_assets (
  user_id BIGINT PRIMARY KEY REFERENCES users(id),
  extra_spins BIGINT NOT NULL DEFAULT 0,
  card_draws BIGINT NOT NULL DEFAULT 0,
  makeup_cards BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (extra_spins >= 0),
  CHECK (card_draws >= 0),
  CHECK (makeup_cards >= 0)
);

-- +goose Down
DROP TABLE IF EXISTS user_assets;
DROP TABLE IF EXISTS exchange_logs;
DROP TABLE IF EXISTS store_daily_purchases;
DROP TABLE IF EXISTS store_items;
DROP TABLE IF EXISTS store_categories;
