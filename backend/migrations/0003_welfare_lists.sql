-- +goose Up
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  max_claims BIGINT NOT NULL DEFAULT 0,
  claimed_count BIGINT NOT NULL DEFAULT 0,
  codes_count BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  reward_type TEXT,
  direct_points BIGINT,
  new_user_only BOOLEAN NOT NULL DEFAULT false,
  pinned BOOLEAN NOT NULL DEFAULT false,
  pinned_at_ms BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (max_claims >= 0),
  CHECK (claimed_count >= 0),
  CHECK (codes_count >= 0),
  CHECK (status IN ('active', 'paused', 'exhausted')),
  CHECK (reward_type IS NULL OR reward_type IN ('code', 'direct')),
  CHECK (direct_points IS NULL OR direct_points > 0)
);

CREATE INDEX IF NOT EXISTS idx_projects_public_sort
  ON projects(status, pinned DESC, pinned_at_ms DESC, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS raffles (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'draw',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_image TEXT,
  prizes JSONB NOT NULL DEFAULT '[]'::jsonb,
  trigger_type TEXT NOT NULL DEFAULT 'threshold',
  threshold BIGINT NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  participants_count BIGINT NOT NULL DEFAULT 0,
  winners_count BIGINT NOT NULL DEFAULT 0,
  drawn_at_ms BIGINT,
  red_packet_total_points BIGINT,
  red_packet_total_slots BIGINT,
  red_packet_remaining_points BIGINT,
  red_packet_remaining_slots BIGINT,
  created_by BIGINT NOT NULL DEFAULT 0,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mode IN ('draw', 'red_packet')),
  CHECK (trigger_type IN ('threshold', 'manual')),
  CHECK (threshold >= 0),
  CHECK (status IN ('draft', 'active', 'ended', 'cancelled')),
  CHECK (participants_count >= 0),
  CHECK (winners_count >= 0),
  CHECK (red_packet_total_points IS NULL OR red_packet_total_points >= 0),
  CHECK (red_packet_total_slots IS NULL OR red_packet_total_slots >= 0),
  CHECK (red_packet_remaining_points IS NULL OR red_packet_remaining_points >= 0),
  CHECK (red_packet_remaining_slots IS NULL OR red_packet_remaining_slots >= 0)
);

CREATE INDEX IF NOT EXISTS idx_raffles_public_sort
  ON raffles(status, created_at_ms DESC);

-- +goose Down
DROP TABLE IF EXISTS raffles;
DROP TABLE IF EXISTS projects;
