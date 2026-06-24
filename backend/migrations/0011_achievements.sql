-- +goose Up
CREATE TABLE IF NOT EXISTS user_achievement_grants (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  source TEXT NOT NULL,
  granted_at_ms BIGINT NOT NULL,
  expires_at_ms BIGINT,
  reason TEXT,
  granted_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  granted_by_username TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id),
  CHECK (achievement_id IN (
    'beginner', 'first_checkin', 'checkin_3', 'checkin_7', 'checkin_30',
    'first_pot', 'small_success', 'tycoon',
    'card_beginner', 'card_collector', 'collection_master',
    'lottery_player', 'contributor', 'peak_first',
    'game_king', 'farm_owner', 'lucky_star', 'unlucky_star',
    'eco_ambassador', 'gold_digger', 'xiaoc_fan', 'thief'
  )),
  CHECK (source IN ('auto', 'admin', 'ranking_monthly')),
  CHECK (granted_at_ms > 0),
  CHECK (expires_at_ms IS NULL OR expires_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_user_achievement_grants_user_active
  ON user_achievement_grants(user_id, expires_at_ms);

CREATE TABLE IF NOT EXISTS user_equipped_achievements (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (achievement_id IN (
    'beginner', 'first_checkin', 'checkin_3', 'checkin_7', 'checkin_30',
    'first_pot', 'small_success', 'tycoon',
    'card_beginner', 'card_collector', 'collection_master',
    'lottery_player', 'contributor', 'peak_first',
    'game_king', 'farm_owner', 'lucky_star', 'unlucky_star',
    'eco_ambassador', 'gold_digger', 'xiaoc_fan', 'thief'
  )),
  CHECK (updated_at_ms > 0)
);

CREATE TABLE IF NOT EXISTS user_forced_achievements (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  until_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (achievement_id IN (
    'beginner', 'first_checkin', 'checkin_3', 'checkin_7', 'checkin_30',
    'first_pot', 'small_success', 'tycoon',
    'card_beginner', 'card_collector', 'collection_master',
    'lottery_player', 'contributor', 'peak_first',
    'game_king', 'farm_owner', 'lucky_star', 'unlucky_star',
    'eco_ambassador', 'gold_digger', 'xiaoc_fan', 'thief'
  )),
  CHECK (until_ms > 0),
  CHECK (updated_at_ms > 0)
);

-- +goose Down
DROP TABLE IF EXISTS user_forced_achievements;
DROP TABLE IF EXISTS user_equipped_achievements;
DROP TABLE IF EXISTS user_achievement_grants;
