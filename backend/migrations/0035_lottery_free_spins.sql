-- +goose Up
ALTER TABLE lottery_daily_spins ADD COLUMN IF NOT EXISTS free_used_count BIGINT NOT NULL DEFAULT 0;
UPDATE lottery_daily_spins SET free_used_count = 1 WHERE daily_free_claimed AND free_used_count = 0;
ALTER TABLE lottery_daily_spins ADD CONSTRAINT lottery_daily_spins_free_used_count_check
  CHECK (free_used_count >= 0);

-- +goose Down
ALTER TABLE lottery_daily_spins DROP CONSTRAINT IF EXISTS lottery_daily_spins_free_used_count_check;
ALTER TABLE lottery_daily_spins DROP COLUMN IF EXISTS free_used_count;
