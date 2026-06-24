-- +goose Up
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at_ms BIGINT NOT NULL,
  read_at_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id > 0),
  CHECK (type IN ('system', 'announcement', 'feedback_reply', 'feedback_status', 'lottery_win', 'raffle_win', 'wallet', 'reward')),
  CHECK (created_at_ms > 0),
  CHECK (read_at_ms IS NULL OR read_at_ms >= created_at_ms)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, created_at_ms DESC)
  WHERE read_at_ms IS NULL;

-- +goose Down
DROP TABLE IF EXISTS notifications;
