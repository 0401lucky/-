-- +goose Up
CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_logs_project_direct_unique
  ON exchange_logs(user_id, item_id)
  WHERE type = 'project_direct';

-- +goose Down
DROP INDEX IF EXISTS idx_exchange_logs_project_direct_unique;
