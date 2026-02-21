-- D1 KV Store Schema
-- Replaces @vercel/kv (Upstash Redis) with Cloudflare D1 (SQLite)

CREATE TABLE kv_data (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER  -- millisecond timestamp, NULL = never expires
);

CREATE TABLE kv_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value TEXT NOT NULL
);
CREATE INDEX idx_kv_lists_key ON kv_lists(key, id);

CREATE TABLE kv_sets (
  key TEXT NOT NULL,
  member TEXT NOT NULL,
  PRIMARY KEY (key, member)
);

CREATE TABLE kv_zsets (
  key TEXT NOT NULL,
  member TEXT NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (key, member)
);
CREATE INDEX idx_kv_zsets_score ON kv_zsets(key, score, member);

CREATE TABLE kv_hashes (
  key TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (key, field)
);

-- 非 string 类型 key 的过期信息（list/set/zset/hash）
CREATE TABLE IF NOT EXISTS kv_key_expirations (
  key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kv_key_expirations_expires_at
  ON kv_key_expirations(expires_at);
