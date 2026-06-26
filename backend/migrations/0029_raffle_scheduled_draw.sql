-- +goose Up
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS scheduled_draw_at_ms BIGINT;

ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_trigger_type_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_trigger_type_check
  CHECK (trigger_type IN ('threshold', 'manual', 'scheduled'));

ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_scheduled_draw_at_ms_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_scheduled_draw_at_ms_check
  CHECK (scheduled_draw_at_ms IS NULL OR scheduled_draw_at_ms > 0);

CREATE INDEX IF NOT EXISTS idx_raffles_scheduled_draw
  ON raffles(status, scheduled_draw_at_ms)
  WHERE trigger_type = 'scheduled';

-- +goose Down
DROP INDEX IF EXISTS idx_raffles_scheduled_draw;

ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_scheduled_draw_at_ms_check;

ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_trigger_type_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_trigger_type_check
  CHECK (trigger_type IN ('threshold', 'manual'));

ALTER TABLE raffles
  DROP COLUMN IF EXISTS scheduled_draw_at_ms;
