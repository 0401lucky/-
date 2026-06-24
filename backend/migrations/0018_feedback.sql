-- +goose Up
CREATE TABLE IF NOT EXISTS feedback_items (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  username TEXT NOT NULL,
  title TEXT,
  contact TEXT,
  anonymous BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  archived_at_ms BIGINT,
  raw_item JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (user_id > 0),
  CHECK (username <> ''),
  CHECK (status IN ('open', 'processing', 'resolved', 'closed')),
  CHECK (created_at_ms > 0),
  CHECK (updated_at_ms > 0),
  CHECK (archived_at_ms IS NULL OR archived_at_ms > 0),
  CHECK (jsonb_typeof(raw_item) = 'object')
);

CREATE INDEX IF NOT EXISTS feedback_items_user_updated_idx
  ON feedback_items (user_id, updated_at_ms DESC);

CREATE INDEX IF NOT EXISTS feedback_items_status_updated_idx
  ON feedback_items (status, updated_at_ms DESC)
  WHERE archived_at_ms IS NULL;

CREATE INDEX IF NOT EXISTS feedback_items_wall_updated_idx
  ON feedback_items (updated_at_ms DESC)
  WHERE archived_at_ms IS NULL AND anonymous = false;

CREATE INDEX IF NOT EXISTS feedback_items_archived_idx
  ON feedback_items (archived_at_ms DESC)
  WHERE archived_at_ms IS NOT NULL;

CREATE TABLE IF NOT EXISTS feedback_messages (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at_ms BIGINT NOT NULL,
  created_by TEXT NOT NULL,
  raw_message JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id <> ''),
  CHECK (feedback_id <> ''),
  CHECK (role IN ('user', 'admin')),
  CHECK (created_at_ms > 0),
  CHECK (created_by <> ''),
  CHECK (jsonb_typeof(images) = 'array'),
  CHECK (jsonb_typeof(raw_message) = 'object')
);

CREATE INDEX IF NOT EXISTS feedback_messages_feedback_created_idx
  ON feedback_messages (feedback_id, created_at_ms ASC);

CREATE TABLE IF NOT EXISTS feedback_likes (
  feedback_id TEXT NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  liked_at_ms BIGINT,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (feedback_id, user_id),
  CHECK (feedback_id <> ''),
  CHECK (user_id > 0),
  CHECK (liked_at_ms IS NULL OR liked_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS feedback_likes_user_idx
  ON feedback_likes (user_id);

-- +goose Down
DROP TABLE IF EXISTS feedback_likes;
DROP TABLE IF EXISTS feedback_messages;
DROP TABLE IF EXISTS feedback_items;
