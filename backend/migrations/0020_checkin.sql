-- +goose Up
CREATE TABLE IF NOT EXISTS checkin_records (
  user_id BIGINT NOT NULL REFERENCES users(id),
  checkin_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'daily',
  points_awarded BIGINT NOT NULL DEFAULT 0,
  extra_spins_awarded BIGINT NOT NULL DEFAULT 0,
  week_broken BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, checkin_date),
  CHECK (source IN ('daily', 'makeup')),
  CHECK (points_awarded >= 0),
  CHECK (extra_spins_awarded >= 0)
);

CREATE INDEX IF NOT EXISTS idx_checkin_records_user_created_at
  ON checkin_records(user_id, checkin_date DESC);

-- +goose Down
DROP TABLE IF EXISTS checkin_records;
