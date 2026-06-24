-- +goose Up
CREATE TABLE IF NOT EXISTS farm_states (
  user_id BIGINT PRIMARY KEY REFERENCES users(id),
  state_json JSONB NOT NULL,
  last_tick_at_ms BIGINT NOT NULL DEFAULT 0,
  updated_at_ms BIGINT NOT NULL,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(state_json) = 'object'),
  CHECK (last_tick_at_ms >= 0),
  CHECK (updated_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_farm_states_updated_at_ms
  ON farm_states(updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS farm_daily_shop_purchases (
  user_id BIGINT NOT NULL REFERENCES users(id),
  purchase_date DATE NOT NULL,
  item_key TEXT NOT NULL,
  purchase_count BIGINT NOT NULL DEFAULT 0,
  updated_at_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, purchase_date, item_key),
  CHECK (item_key <> ''),
  CHECK (purchase_count >= 0),
  CHECK (updated_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_farm_daily_shop_purchases_date
  ON farm_daily_shop_purchases(purchase_date DESC, user_id);

CREATE TABLE IF NOT EXISTS farm_maturity_email_dedupes (
  user_id BIGINT NOT NULL REFERENCES users(id),
  event_id TEXT NOT NULL,
  sent_at_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id),
  CHECK (event_id <> ''),
  CHECK (sent_at_ms > 0)
);

CREATE TABLE IF NOT EXISTS farm_water_email_dedupes (
  user_id BIGINT NOT NULL REFERENCES users(id),
  land_index BIGINT NOT NULL,
  planted_at_ms BIGINT NOT NULL,
  next_water_due_at_ms BIGINT NOT NULL,
  water_miss_count BIGINT NOT NULL,
  sent_at_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, land_index, planted_at_ms, next_water_due_at_ms, water_miss_count),
  CHECK (land_index >= 1),
  CHECK (planted_at_ms > 0),
  CHECK (next_water_due_at_ms > 0),
  CHECK (water_miss_count >= 0),
  CHECK (sent_at_ms > 0)
);

-- +goose Down
DROP TABLE IF EXISTS farm_water_email_dedupes;
DROP TABLE IF EXISTS farm_maturity_email_dedupes;
DROP TABLE IF EXISTS farm_daily_shop_purchases;
DROP TABLE IF EXISTS farm_states;
