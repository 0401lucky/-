-- +goose Up
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS daily_withdraw_limit BIGINT NOT NULL DEFAULT 4;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_daily_withdraw_limit BIGINT NOT NULL DEFAULT 8;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_price_points BIGINT NOT NULL DEFAULT 3000;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_duration_days BIGINT NOT NULL DEFAULT 30;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_withdraw_fee_percent BIGINT NOT NULL DEFAULT 50;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_daily_lottery_spins BIGINT NOT NULL DEFAULT 2;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS vip_max_total_days BIGINT NOT NULL DEFAULT 365;

ALTER TABLE system_config ADD CONSTRAINT system_config_daily_withdraw_limit_check
  CHECK (daily_withdraw_limit BETWEEN 1 AND 100);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_daily_withdraw_limit_check
  CHECK (vip_daily_withdraw_limit BETWEEN 1 AND 100);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_price_points_check
  CHECK (vip_price_points BETWEEN 1 AND 1000000);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_duration_days_check
  CHECK (vip_duration_days BETWEEN 1 AND 365);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_withdraw_fee_percent_check
  CHECK (vip_withdraw_fee_percent BETWEEN 0 AND 100);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_daily_lottery_spins_check
  CHECK (vip_daily_lottery_spins BETWEEN 0 AND 50);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_max_total_days_check
  CHECK (vip_max_total_days BETWEEN 1 AND 3650);
ALTER TABLE system_config ADD CONSTRAINT system_config_vip_max_total_days_gte_duration_check
  CHECK (vip_max_total_days >= vip_duration_days);

-- +goose Down
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_max_total_days_gte_duration_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_max_total_days_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_daily_lottery_spins_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_withdraw_fee_percent_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_duration_days_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_price_points_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_vip_daily_withdraw_limit_check;
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_daily_withdraw_limit_check;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_max_total_days;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_daily_lottery_spins;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_withdraw_fee_percent;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_duration_days;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_price_points;
ALTER TABLE system_config DROP COLUMN IF EXISTS vip_daily_withdraw_limit;
ALTER TABLE system_config DROP COLUMN IF EXISTS daily_withdraw_limit;
