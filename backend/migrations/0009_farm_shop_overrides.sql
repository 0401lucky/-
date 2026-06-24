-- +goose Up
CREATE TABLE IF NOT EXISTS farm_shop_overrides (
  key TEXT PRIMARY KEY,
  cost BIGINT,
  daily_limit BIGINT,
  duration_minutes BIGINT,
  speed_reduce_minutes BIGINT,
  pet_effect JSONB,
  updated_at_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (cost IS NULL OR cost >= 0),
  CHECK (daily_limit IS NULL OR daily_limit >= 0),
  CHECK (duration_minutes IS NULL OR duration_minutes >= 1),
  CHECK (speed_reduce_minutes IS NULL OR speed_reduce_minutes >= 1),
  CHECK (updated_at_ms > 0)
);

-- +goose Down
DROP TABLE IF EXISTS farm_shop_overrides;
