-- +goose Up
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS auto_pause_at_ms BIGINT,
  ADD COLUMN IF NOT EXISTS auto_paused_at_ms BIGINT;

CREATE INDEX IF NOT EXISTS idx_projects_auto_pause_due
  ON projects(auto_pause_at_ms)
  WHERE status = 'active'
    AND auto_pause_at_ms IS NOT NULL
    AND auto_paused_at_ms IS NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_projects_auto_pause_due;
ALTER TABLE projects
  DROP COLUMN IF EXISTS auto_paused_at_ms,
  DROP COLUMN IF EXISTS auto_pause_at_ms;
