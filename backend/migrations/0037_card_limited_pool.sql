-- +goose Up
ALTER TABLE card_rules
  ADD COLUMN limited_pool JSONB NOT NULL DEFAULT jsonb_build_object(
    'enabled', true,
    'albumId', 'hok-modern-s1',
    'drawCost', 2,
    'startsAt', (extract(epoch FROM now()) * 1000)::bigint,
    'endsAt', (extract(epoch FROM (((now() AT TIME ZONE 'Asia/Shanghai') + interval '1 month') AT TIME ZONE 'Asia/Shanghai')) * 1000)::bigint
  ),
  ADD CONSTRAINT card_rules_limited_pool_object CHECK (jsonb_typeof(limited_pool) = 'object');

-- 只补齐缺失的全局规则；已有概率、保底、价格和碎片配置保留。
INSERT INTO card_rules (
  id, rarity_probabilities, pity_thresholds, card_draw_price,
  fragment_values, exchange_prices
) VALUES (
  'default',
  '{"legendary_rare":0.5,"legendary":2,"epic":7,"rare":25,"common":65.5}'::jsonb,
  '{"rare":10,"epic":50,"legendary":100,"legendary_rare":200}'::jsonb,
  900,
  '{"common":9,"rare":14,"epic":26,"legendary":50,"legendary_rare":100}'::jsonb,
  '{"common":30,"rare":80,"epic":200,"legendary":500,"legendary_rare":1000}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- +goose Down
ALTER TABLE card_rules DROP COLUMN limited_pool;
