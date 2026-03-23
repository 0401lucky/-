CREATE TABLE IF NOT EXISTS native_users (
  user_id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS native_auth_session_blacklist (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_native_auth_session_blacklist_expires_at
  ON native_auth_session_blacklist(expires_at);

CREATE TABLE IF NOT EXISTS native_auth_session_revocations (
  user_id INTEGER PRIMARY KEY,
  revoked_after INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_native_auth_session_revocations_expires_at
  ON native_auth_session_revocations(expires_at);

CREATE TABLE IF NOT EXISTS native_auth_login_failures (
  username TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  lock_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS native_rate_limit_counters (
  scope_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_native_rate_limit_counters_reset_at
  ON native_rate_limit_counters(reset_at);

CREATE TABLE IF NOT EXISTS native_distributed_locks (
  lock_key TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_native_distributed_locks_expires_at
  ON native_distributed_locks(expires_at);

CREATE TABLE IF NOT EXISTS native_system_config (
  config_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS native_user_assets (
  user_id INTEGER PRIMARY KEY,
  extra_spins INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS native_user_cards (
  user_id INTEGER PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS native_user_checkins (
  user_id INTEGER NOT NULL,
  checkin_date TEXT NOT NULL,
  quota_awarded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, checkin_date)
);
CREATE INDEX IF NOT EXISTS idx_native_user_checkins_date
  ON native_user_checkins(checkin_date, created_at);

CREATE TABLE IF NOT EXISTS native_user_points (
  user_id INTEGER PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS native_user_point_logs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  source TEXT NOT NULL,
  description TEXT NOT NULL,
  balance INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_native_user_point_logs_user_created_at
  ON native_user_point_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS native_user_daily_game_points (
  user_id INTEGER NOT NULL,
  stat_date TEXT NOT NULL,
  earned_points INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, stat_date)
);

CREATE TABLE IF NOT EXISTS native_game_sessions (
  session_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  game_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_native_game_sessions_user_game
  ON native_game_sessions(user_id, game_type, expires_at);

CREATE TABLE IF NOT EXISTS native_game_active_sessions (
  user_id INTEGER NOT NULL,
  game_type TEXT NOT NULL,
  session_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_type)
);
CREATE INDEX IF NOT EXISTS idx_native_game_active_sessions_expires_at
  ON native_game_active_sessions(expires_at);

CREATE TABLE IF NOT EXISTS native_game_cooldowns (
  user_id INTEGER NOT NULL,
  game_type TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_type)
);
CREATE INDEX IF NOT EXISTS idx_native_game_cooldowns_expires_at
  ON native_game_cooldowns(expires_at);

CREATE TABLE IF NOT EXISTS native_game_records (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  game_type TEXT NOT NULL,
  score INTEGER NOT NULL,
  points_earned INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_native_game_records_user_game_created_at
  ON native_game_records(user_id, game_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_native_game_records_game_created_at
  ON native_game_records(game_type, created_at DESC);

CREATE TABLE IF NOT EXISTS native_game_daily_stats (
  user_id INTEGER NOT NULL,
  stat_date TEXT NOT NULL,
  games_played INTEGER NOT NULL DEFAULT 0,
  total_score INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  last_game_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, stat_date)
);

CREATE TABLE IF NOT EXISTS native_slot_daily_rankings (
  stat_date TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (stat_date, user_id)
);
CREATE INDEX IF NOT EXISTS idx_native_slot_daily_rankings_score
  ON native_slot_daily_rankings(stat_date, score DESC, user_id);

CREATE TABLE IF NOT EXISTS native_ranking_snapshots (
  cache_key TEXT PRIMARY KEY,
  ranking_type TEXT NOT NULL,
  period TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  value_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_native_ranking_snapshots_expires_at
  ON native_ranking_snapshots(expires_at);

CREATE TABLE IF NOT EXISTS native_ranking_settlements (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  period_label TEXT NOT NULL,
  status TEXT NOT NULL,
  reward_policy_json TEXT NOT NULL,
  total_participants INTEGER NOT NULL,
  rewards_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  settled_at INTEGER NOT NULL,
  retry_count INTEGER NOT NULL,
  triggered_by_json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_native_ranking_settlements_window
  ON native_ranking_settlements(period, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_native_ranking_settlements_period_end
  ON native_ranking_settlements(period, period_end DESC);

CREATE TABLE IF NOT EXISTS native_ranking_reward_claims (
  period TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (period, period_start, period_end, user_id)
);
