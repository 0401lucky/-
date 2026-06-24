-- +goose Up
ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS winners JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS red_packet_packets JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS raffle_entries (
  id TEXT PRIMARY KEY,
  raffle_id TEXT NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  username TEXT NOT NULL,
  entry_number BIGINT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id > 0),
  CHECK (entry_number > 0),
  UNIQUE (raffle_id, user_id),
  UNIQUE (raffle_id, entry_number)
);

CREATE INDEX IF NOT EXISTS idx_raffle_entries_raffle_created
  ON raffle_entries(raffle_id, created_at_ms DESC, entry_number DESC);

-- +goose Down
DROP TABLE IF EXISTS raffle_entries;

ALTER TABLE raffles
  DROP COLUMN IF EXISTS red_packet_packets;

ALTER TABLE raffles
  DROP COLUMN IF EXISTS winners;
