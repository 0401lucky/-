-- +goose Up
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS withdraw_balance_cap_dollars BIGINT NOT NULL DEFAULT 10000;

-- 上限取到 1e12 是为了留出「实质关闭本限制」的配置空间：把上限调到远高于任何真实余额
-- 即等价于不限制，因此不额外引入开关字段。
ALTER TABLE system_config ADD CONSTRAINT system_config_withdraw_balance_cap_dollars_check
  CHECK (withdraw_balance_cap_dollars BETWEEN 1 AND 1000000000000);

-- +goose Down
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_withdraw_balance_cap_dollars_check;
ALTER TABLE system_config DROP COLUMN IF EXISTS withdraw_balance_cap_dollars;
