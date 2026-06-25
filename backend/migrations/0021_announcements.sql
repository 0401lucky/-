-- +goose Up
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  published_at_ms BIGINT,
  created_by_id BIGINT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by_id BIGINT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (title <> ''),
  CHECK (content <> ''),
  CHECK (status IN ('draft', 'published', 'archived')),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms >= created_at_ms),
  CHECK (published_at_ms IS NULL OR published_at_ms >= created_at_ms),
  CHECK (created_by_id > 0),
  CHECK (updated_by_id > 0),
  CHECK (created_by <> ''),
  CHECK (updated_by <> '')
);

CREATE INDEX IF NOT EXISTS idx_announcements_updated
  ON announcements(updated_at_ms DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_announcements_published
  ON announcements(published_at_ms DESC, id DESC)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS announcement_notifications (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL,
  notified_at_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id),
  UNIQUE (notification_id),
  CHECK (announcement_id <> ''),
  CHECK (user_id > 0),
  CHECK (notification_id <> ''),
  CHECK (notified_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_announcement_notifications_user
  ON announcement_notifications(user_id, notified_at_ms DESC);

-- +goose Down
DROP TABLE IF EXISTS announcement_notifications;
DROP TABLE IF EXISTS announcements;
