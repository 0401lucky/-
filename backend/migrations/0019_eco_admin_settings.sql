-- +goose Up
CREATE TABLE IF NOT EXISTS eco_prize_rate_settings (
  prize_key TEXT PRIMARY KEY,
  spawn_rate DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (prize_key IN ('diamond', 'coin', 'necklace', 'trophy', 'photo')),
  CHECK (spawn_rate >= 0),
  CHECK (spawn_rate <= 1)
);

-- +goose Down
DROP TABLE IF EXISTS eco_prize_rate_settings;
