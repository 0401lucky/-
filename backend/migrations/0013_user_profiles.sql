-- +goose Up
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  qq_email TEXT,
  updated_at_ms BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (display_name IS NULL OR char_length(display_name) <= 30),
  CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 81920),
  CHECK (qq_email IS NULL OR char_length(qq_email) <= 254),
  CHECK (updated_at_ms IS NULL OR updated_at_ms > 0)
);

-- +goose Down
DROP TABLE IF EXISTS user_profiles;
