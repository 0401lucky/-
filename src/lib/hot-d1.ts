import { getCloudflareContext } from "@opennextjs/cloudflare";
import { kv } from "@/lib/d1-kv";
import { getTodayDateString } from "./time";
import type { UserCards } from "./cards/draw";
import type { DailyGameStats, GameType } from "./types/game";
import type { PointsLog, PointsSource } from "./types/store";

interface D1Result<T = unknown> {
  results: T[];
  meta?: { changes?: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface NativeRateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

export interface NativeSettlementRecordPayload {
  id: string;
  period: "weekly" | "monthly";
  periodStart: number;
  periodEnd: number;
  periodLabel: string;
  status: "success" | "partial" | "failed";
  rewardPolicy: unknown;
  totalParticipants: number;
  rewards: unknown[];
  summary: unknown;
  createdAt: number;
  settledAt: number;
  retryCount: number;
  triggeredBy: unknown;
}

type CloudflareEnvLike = { KV_DB?: unknown };

const HOT_STORE_READY_KEY = "native:hot-store:ready";
const SYSTEM_CONFIG_KEY = "system:config";
const DEFAULT_READY_CACHE_TTL_MS = 60_000;

const GAME_RECORD_TABLE_TYPES = new Set<GameType>([
  "slot",
  "linkgame",
  "match3",
  "memory",
  "pachinko",
  "tower",
  "farm",
]);

let hotDb: D1DatabaseLike | null = null;
let schemaReady = false;
let schemaPromise: Promise<void> | null = null;
let readyCache: { value: boolean; expiresAt: number } | null = null;

function nowMs(): number {
  return Date.now();
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function deserialize<T>(raw: string | null | undefined): T | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

function hasD1Binding(): boolean {
  try {
    const context = getCloudflareContext() as { env?: CloudflareEnvLike } | undefined;
    return !!context?.env?.KV_DB;
  } catch {
    return false;
  }
}

function getHotDb(): D1DatabaseLike {
  if (hotDb) {
    return hotDb;
  }

  const context = getCloudflareContext() as { env?: CloudflareEnvLike } | undefined;
  const db = context?.env?.KV_DB;
  if (!db) {
    throw new Error("D1 binding KV_DB not available for native hot store");
  }

  hotDb = db as D1DatabaseLike;
  return hotDb;
}

async function ensureHotSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  if (!schemaPromise) {
    const db = getHotDb();
    schemaPromise = (async () => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS native_users (
          user_id INTEGER PRIMARY KEY,
          username TEXT NOT NULL,
          first_seen INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS native_auth_session_blacklist (
          jti TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_native_auth_session_blacklist_expires_at
          ON native_auth_session_blacklist(expires_at)`,
        `CREATE TABLE IF NOT EXISTS native_auth_session_revocations (
          user_id INTEGER PRIMARY KEY,
          revoked_after INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_native_auth_session_revocations_expires_at
          ON native_auth_session_revocations(expires_at)`,
        `CREATE TABLE IF NOT EXISTS native_auth_login_failures (
          username TEXT PRIMARY KEY,
          attempts INTEGER NOT NULL,
          window_started_at INTEGER NOT NULL,
          lock_until INTEGER NOT NULL DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS native_rate_limit_counters (
          scope_key TEXT PRIMARY KEY,
          count INTEGER NOT NULL,
          reset_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_native_rate_limit_counters_reset_at
          ON native_rate_limit_counters(reset_at)`,
        `CREATE TABLE IF NOT EXISTS native_distributed_locks (
          lock_key TEXT PRIMARY KEY,
          token TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_native_distributed_locks_expires_at
          ON native_distributed_locks(expires_at)`,
        `CREATE TABLE IF NOT EXISTS native_system_config (
          config_key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS native_user_assets (
          user_id INTEGER PRIMARY KEY,
          extra_spins INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS native_user_cards (
          user_id INTEGER PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS native_user_checkins (
          user_id INTEGER NOT NULL,
          checkin_date TEXT NOT NULL,
          quota_awarded INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, checkin_date)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_native_user_checkins_date
          ON native_user_checkins(checkin_date, created_at)`,
        `CREATE TABLE IF NOT EXISTS native_user_points (
          user_id INTEGER PRIMARY KEY,
          balance INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS native_user_point_logs (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          amount INTEGER NOT NULL,
          source TEXT NOT NULL,
          description TEXT NOT NULL,
          balance INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_native_user_point_logs_user_created_at
          ON native_user_point_logs(user_id, created_at DESC)`,
        `CREATE TABLE IF NOT EXISTS native_user_daily_game_points (
          user_id INTEGER NOT NULL,
          stat_date TEXT NOT NULL,
          earned_points INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, stat_date)
        )`,
        `CREATE TABLE IF NOT EXISTS native_game_sessions (
          session_id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          game_type TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          payload_json TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_native_game_sessions_user_game
          ON native_game_sessions(user_id, game_type, expires_at)`,
        `CREATE TABLE IF NOT EXISTS native_game_active_sessions (
          user_id INTEGER NOT NULL,
          game_type TEXT NOT NULL,
          session_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, game_type)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_native_game_active_sessions_expires_at
          ON native_game_active_sessions(expires_at)`,
        `CREATE TABLE IF NOT EXISTS native_game_cooldowns (
          user_id INTEGER NOT NULL,
          game_type TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, game_type)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_native_game_cooldowns_expires_at
          ON native_game_cooldowns(expires_at)`,
        `CREATE TABLE IF NOT EXISTS native_game_records (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          game_type TEXT NOT NULL,
          score INTEGER NOT NULL,
          points_earned INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          payload_json TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_native_game_records_user_game_created_at
          ON native_game_records(user_id, game_type, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_native_game_records_game_created_at
          ON native_game_records(game_type, created_at DESC)`,
        `CREATE TABLE IF NOT EXISTS native_game_daily_stats (
          user_id INTEGER NOT NULL,
          stat_date TEXT NOT NULL,
          games_played INTEGER NOT NULL DEFAULT 0,
          total_score INTEGER NOT NULL DEFAULT 0,
          points_earned INTEGER NOT NULL DEFAULT 0,
          last_game_at INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, stat_date)
        )`,
        `CREATE TABLE IF NOT EXISTS native_slot_daily_rankings (
          stat_date TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          score INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (stat_date, user_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_native_slot_daily_rankings_score
          ON native_slot_daily_rankings(stat_date, score DESC, user_id)`,
        `CREATE TABLE IF NOT EXISTS native_ranking_snapshots (
          cache_key TEXT PRIMARY KEY,
          ranking_type TEXT NOT NULL,
          period TEXT NOT NULL,
          generated_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          value_json TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_native_ranking_snapshots_expires_at
          ON native_ranking_snapshots(expires_at)`,
        `CREATE TABLE IF NOT EXISTS native_ranking_settlements (
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
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_native_ranking_settlements_window
          ON native_ranking_settlements(period, period_start, period_end)`,
        `CREATE INDEX IF NOT EXISTS idx_native_ranking_settlements_period_end
          ON native_ranking_settlements(period, period_end DESC)`,
        `CREATE TABLE IF NOT EXISTS native_ranking_reward_claims (
          period TEXT NOT NULL,
          period_start INTEGER NOT NULL,
          period_end INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          processed_at INTEGER NOT NULL,
          PRIMARY KEY (period, period_start, period_end, user_id)
        )`,
      ];

      for (const statement of statements) {
        await db.prepare(statement).run();
      }

      schemaReady = true;
    })();
  }

  await schemaPromise;
}

function invalidateReadyCache(): void {
  readyCache = null;
}

export function hasNativeHotStoreBinding(): boolean {
  return hasD1Binding();
}

export async function isNativeHotStoreReady(): Promise<boolean> {
  if (!hasNativeHotStoreBinding()) {
    return false;
  }

  const now = nowMs();
  if (readyCache && readyCache.expiresAt > now) {
    return readyCache.value;
  }

  await ensureHotSchema();
  const row = await getHotDb()
    .prepare("SELECT value_json FROM native_system_config WHERE config_key = ?")
    .bind(HOT_STORE_READY_KEY)
    .first<{ value_json: string }>();

  const enabled = deserialize<boolean>(row?.value_json) === true;
  readyCache = {
    value: enabled,
    expiresAt: now + DEFAULT_READY_CACHE_TTL_MS,
  };
  return enabled;
}

export async function setNativeHotStoreReady(enabled: boolean): Promise<void> {
  await ensureHotSchema();
  const now = nowMs();
  await getHotDb()
    .prepare(
      `INSERT INTO native_system_config (config_key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(config_key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    )
    .bind(HOT_STORE_READY_KEY, serialize(enabled), now)
    .run();
  invalidateReadyCache();
}

export async function upsertNativeUser(
  userId: number,
  username: string,
  firstSeen: number = nowMs(),
): Promise<void> {
  await ensureHotSchema();
  const now = nowMs();
  await getHotDb()
    .prepare(
      `INSERT INTO native_users (user_id, username, first_seen, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         username = excluded.username,
         first_seen = MIN(native_users.first_seen, excluded.first_seen),
         updated_at = excluded.updated_at`,
    )
    .bind(userId, username, firstSeen, now)
    .run();
}

export async function listNativeUsers(): Promise<Array<{ id: number; username: string; firstSeen: number }>> {
  await ensureHotSchema();
  const rows = await getHotDb()
    .prepare(
      `SELECT user_id AS id, username, first_seen AS firstSeen
       FROM native_users
       ORDER BY user_id ASC`,
    )
    .all<{ id: number; username: string; firstSeen: number }>();

  return rows.results;
}

export async function getNativeSessionRevocationState(
  userId: number,
  jti: string,
): Promise<{ blacklisted: boolean; revokedAfter: number }> {
  await ensureHotSchema();
  const now = nowMs();
  const db = getHotDb();
  const [blacklistRow, revokedRow] = await Promise.all([
    db.prepare(
      `SELECT 1 AS ok
       FROM native_auth_session_blacklist
       WHERE jti = ? AND expires_at > ?
       LIMIT 1`,
    )
      .bind(jti, now)
      .first<{ ok: number }>(),
    db.prepare(
      `SELECT revoked_after AS revokedAfter
       FROM native_auth_session_revocations
       WHERE user_id = ? AND expires_at > ?
       LIMIT 1`,
    )
      .bind(userId, now)
      .first<{ revokedAfter: number }>(),
  ]);

  return {
    blacklisted: !!blacklistRow,
    revokedAfter: revokedRow?.revokedAfter ?? 0,
  };
}

export async function blacklistNativeSession(
  jti: string,
  expiresAt: number,
): Promise<void> {
  await ensureHotSchema();
  await getHotDb()
    .prepare(
      `INSERT INTO native_auth_session_blacklist (jti, expires_at)
       VALUES (?, ?)
       ON CONFLICT(jti) DO UPDATE SET expires_at = excluded.expires_at`,
    )
    .bind(jti, expiresAt)
    .run();
}

export async function revokeNativeUserSessions(
  userId: number,
  revokedAfter: number,
  expiresAt: number,
): Promise<void> {
  await ensureHotSchema();
  await getHotDb()
    .prepare(
      `INSERT INTO native_auth_session_revocations (user_id, revoked_after, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         revoked_after = excluded.revoked_after,
         expires_at = excluded.expires_at`,
    )
    .bind(userId, revokedAfter, expiresAt)
    .run();
}

export async function getNativeLoginFailureState(
  username: string,
): Promise<{ attempts: number; lockUntil: number; windowStartedAt: number } | null> {
  await ensureHotSchema();
  const row = await getHotDb()
    .prepare(
      `SELECT attempts, lock_until AS lockUntil, window_started_at AS windowStartedAt
       FROM native_auth_login_failures
       WHERE username = ?`,
    )
    .bind(username)
    .first<{ attempts: number; lockUntil: number; windowStartedAt: number }>();
  return row ?? null;
}

export async function recordNativeLoginFailure(
  username: string,
  windowSeconds: number,
  threshold: number,
  lockSeconds: number,
): Promise<{ locked: boolean; remainingSeconds: number; attempts: number }> {
  await ensureHotSchema();
  const now = nowMs();
  const nextWindowStart = now;
  const lockDurationMs = lockSeconds * 1000;
  const row = await getHotDb()
    .prepare(
      `INSERT INTO native_auth_login_failures (username, attempts, window_started_at, lock_until)
       VALUES (?, 1, ?, 0)
       ON CONFLICT(username) DO UPDATE SET
         attempts = CASE
           WHEN native_auth_login_failures.lock_until > ? THEN native_auth_login_failures.attempts
           WHEN native_auth_login_failures.window_started_at + (? * 1000) <= ? THEN 1
           ELSE native_auth_login_failures.attempts + 1
         END,
         window_started_at = CASE
           WHEN native_auth_login_failures.lock_until > ? THEN native_auth_login_failures.window_started_at
           WHEN native_auth_login_failures.window_started_at + (? * 1000) <= ? THEN ?
           ELSE native_auth_login_failures.window_started_at
         END,
         lock_until = CASE
           WHEN native_auth_login_failures.lock_until > ? THEN native_auth_login_failures.lock_until
           WHEN (
             CASE
               WHEN native_auth_login_failures.window_started_at + (? * 1000) <= ? THEN 1
               ELSE native_auth_login_failures.attempts + 1
             END
           ) >= ? THEN ?
           ELSE 0
         END
       RETURNING attempts, lock_until AS lockUntil`,
    )
    .bind(
      username,
      nextWindowStart,
      now,
      windowSeconds,
      now,
      now,
      windowSeconds,
      now,
      nextWindowStart,
      now,
      windowSeconds,
      now,
      threshold,
      now + lockDurationMs,
    )
    .first<{ attempts: number; lockUntil: number }>();

  const attempts = row?.attempts ?? 1;
  const lockUntil = row?.lockUntil ?? 0;
  if (lockUntil > now) {
    return {
      locked: true,
      remainingSeconds: Math.max(1, Math.ceil((lockUntil - now) / 1000)),
      attempts,
    };
  }

  return {
    locked: false,
    remainingSeconds: 0,
    attempts,
  };
}

export async function clearNativeLoginFailures(username: string): Promise<void> {
  await ensureHotSchema();
  await getHotDb()
    .prepare("DELETE FROM native_auth_login_failures WHERE username = ?")
    .bind(username)
    .run();
}

export async function incrementNativeRateLimit(
  scopeKey: string,
  windowSeconds: number,
  maxRequests: number,
): Promise<NativeRateLimitResult> {
  await ensureHotSchema();
  const now = Math.floor(nowMs() / 1000);
  const resetAt = now + windowSeconds;
  const row = await getHotDb()
    .prepare(
      `INSERT INTO native_rate_limit_counters (scope_key, count, reset_at)
       VALUES (?, 1, ?)
       ON CONFLICT(scope_key) DO UPDATE SET
         count = CASE
           WHEN native_rate_limit_counters.reset_at <= ? THEN 1
           ELSE native_rate_limit_counters.count + 1
         END,
         reset_at = CASE
           WHEN native_rate_limit_counters.reset_at <= ? THEN excluded.reset_at
           ELSE native_rate_limit_counters.reset_at
         END
       RETURNING count, reset_at AS resetAt`,
    )
    .bind(scopeKey, resetAt, now, now)
    .first<{ count: number; resetAt: number }>();

  const count = row?.count ?? 1;
  const nextResetAt = row?.resetAt ?? resetAt;
  return {
    success: count <= maxRequests,
    remaining: Math.max(0, maxRequests - count),
    resetAt: nextResetAt,
  };
}

export async function acquireNativeLock(
  lockKey: string,
  token: string,
  ttlSeconds: number,
): Promise<boolean> {
  await ensureHotSchema();
  const now = nowMs();
  const expiresAt = now + ttlSeconds * 1000;
  const row = await getHotDb()
    .prepare(
      `INSERT INTO native_distributed_locks (lock_key, token, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(lock_key) DO UPDATE SET
         token = excluded.token,
         expires_at = excluded.expires_at
       WHERE native_distributed_locks.expires_at <= ?
       RETURNING token`,
    )
    .bind(lockKey, token, expiresAt, now)
    .first<{ token: string }>();

  return row?.token === token;
}

export async function releaseNativeLock(lockKey: string, token: string): Promise<void> {
  await ensureHotSchema();
  await getHotDb()
    .prepare("DELETE FROM native_distributed_locks WHERE lock_key = ? AND token = ?")
    .bind(lockKey, token)
    .run();
}

export async function getNativeSystemConfig<T>(defaultValue: T): Promise<T> {
  await ensureHotSchema();
  const row = await getHotDb()
    .prepare("SELECT value_json FROM native_system_config WHERE config_key = ?")
    .bind(SYSTEM_CONFIG_KEY)
    .first<{ value_json: string }>();

  return deserialize<T>(row?.value_json) ?? defaultValue;
}

export async function updateNativeSystemConfig<T>(
  value: T,
): Promise<T> {
  await ensureHotSchema();
  const now = nowMs();
  await getHotDb()
    .prepare(
      `INSERT INTO native_system_config (config_key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(config_key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    )
    .bind(SYSTEM_CONFIG_KEY, serialize(value), now)
    .run();
  return value;
}

export async function getNativeExtraSpinCount(userId: number): Promise<number> {
  await ensureHotSchema();
  const row = await getHotDb()
    .prepare(
      `SELECT extra_spins AS extraSpins
       FROM native_user_assets
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{ extraSpins: number }>();
  return row?.extraSpins ?? 0;
}

export async function setNativeExtraSpinCount(userId: number, extraSpins: number): Promise<void> {
  await ensureHotSchema();
  const now = nowMs();
  await getHotDb()
    .prepare(
      `INSERT INTO native_user_assets (user_id, extra_spins, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         extra_spins = excluded.extra_spins,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, Math.max(0, Math.floor(extraSpins)), now)
    .run();
}

export async function incrementNativeExtraSpinCount(
  userId: number,
  increment: number,
): Promise<number> {
  await ensureHotSchema();
  const now = nowMs();
  const row = await getHotDb()
    .prepare(
      `INSERT INTO native_user_assets (user_id, extra_spins, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         extra_spins = MAX(0, native_user_assets.extra_spins + excluded.extra_spins),
         updated_at = excluded.updated_at
       RETURNING extra_spins AS extraSpins`,
    )
    .bind(userId, increment, now)
    .first<{ extraSpins: number }>();

  return row?.extraSpins ?? Math.max(0, increment);
}

export async function getNativeUserCards(userId: number): Promise<UserCards | null> {
  await ensureHotSchema();
  const row = await getHotDb()
    .prepare(
      `SELECT value_json AS valueJson
       FROM native_user_cards
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{ valueJson: string }>();

  return deserialize<UserCards>(row?.valueJson);
}

export async function setNativeUserCards(userId: number, cards: UserCards): Promise<void> {
  await ensureHotSchema();
  const now = nowMs();
  await getHotDb()
    .prepare(
      `INSERT INTO native_user_cards (user_id, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, serialize(cards), now)
    .run();
}

export async function hasNativeCheckedIn(userId: number, dateStr: string): Promise<boolean> {
  await ensureHotSchema();
  const row = await getHotDb()
    .prepare(
      `SELECT 1 AS ok
       FROM native_user_checkins
       WHERE user_id = ? AND checkin_date = ?
       LIMIT 1`,
    )
    .bind(userId, dateStr)
    .first<{ ok: number }>();
  return !!row;
}

export async function grantNativeCheckinRewards(
  userId: number,
  dateStr: string,
  extraSpins: number,
  cards: UserCards,
  quotaAwarded: number = 0,
): Promise<{ granted: boolean; extraSpins: number; cards: UserCards }> {
  await ensureHotSchema();
  const now = nowMs();
  const db = getHotDb();
  const inserted = await db
    .prepare(
      `INSERT INTO native_user_checkins (user_id, checkin_date, quota_awarded, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, checkin_date) DO NOTHING
       RETURNING user_id AS userId`,
    )
    .bind(userId, dateStr, quotaAwarded, now)
    .first<{ userId: number }>();

  if (!inserted) {
    return {
      granted: false,
      extraSpins: await getNativeExtraSpinCount(userId),
      cards: (await getNativeUserCards(userId)) ?? cards,
    };
  }

  const nextSpins = await incrementNativeExtraSpinCount(userId, extraSpins);
  await setNativeUserCards(userId, cards);
  return {
    granted: true,
    extraSpins: nextSpins,
    cards,
  };
}

export async function listNativeCheckinDates(
  userId: number,
  limitDays: number = 400,
): Promise<string[]> {
  await ensureHotSchema();
  const rows = await getHotDb()
    .prepare(
      `SELECT checkin_date AS checkinDate
       FROM native_user_checkins
       WHERE user_id = ?
       ORDER BY checkin_date DESC
       LIMIT ?`,
    )
    .bind(userId, limitDays)
    .all<{ checkinDate: string }>();

  return rows.results.map((row) => row.checkinDate);
}

export async function getNativeUserPoints(userId: number): Promise<number> {
  await ensureHotSchema();
  const row = await getHotDb()
    .prepare(
      `SELECT balance
       FROM native_user_points
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{ balance: number }>();

  return row?.balance ?? 0;
}

export async function setNativeUserPoints(userId: number, balance: number): Promise<void> {
  await ensureHotSchema();
  const now = nowMs();
  await getHotDb()
    .prepare(
      `INSERT INTO native_user_points (user_id, balance, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         balance = excluded.balance,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, Math.floor(balance), now)
    .run();
}

export async function appendNativePointLog(log: PointsLog & { userId: number }): Promise<void> {
  await ensureHotSchema();
  await getHotDb()
    .prepare(
      `INSERT OR REPLACE INTO native_user_point_logs
       (id, user_id, amount, source, description, balance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      log.id,
      log.userId,
      Math.floor(log.amount),
      log.source,
      log.description,
      Math.floor(log.balance),
      Math.floor(log.createdAt),
    )
    .run();
}

export async function trimNativePointLogs(userId: number, maxEntries: number): Promise<void> {
  await ensureHotSchema();
  await getHotDb()
    .prepare(
      `DELETE FROM native_user_point_logs
       WHERE user_id = ?
         AND id NOT IN (
           SELECT id
           FROM native_user_point_logs
           WHERE user_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?
         )`,
    )
    .bind(userId, userId, maxEntries)
    .run();
}

export async function getNativePointsLogs(
  userId: number,
  limit: number,
): Promise<PointsLog[]> {
  await ensureHotSchema();
  const rows = await getHotDb()
    .prepare(
      `SELECT id, amount, source, description, balance, created_at AS createdAt
       FROM native_user_point_logs
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<{
      id: string;
      amount: number;
      source: PointsSource;
      description: string;
      balance: number;
      createdAt: number;
    }>();

  return rows.results.map((row) => ({
    id: row.id,
    amount: row.amount,
    source: row.source,
    description: row.description,
    balance: row.balance,
    createdAt: row.createdAt,
  }));
}

export async function applyNativePointsDelta(
  userId: number,
  delta: number,
  source: PointsSource,
  description: string,
  logId: string,
  createdAt: number = nowMs(),
): Promise<{ success: boolean; balance: number; message?: string }> {
  await ensureHotSchema();
  const current = await getNativeUserPoints(userId);
  if (delta < 0 && current < Math.abs(delta)) {
    return { success: false, balance: current, message: "积分不足" };
  }

  const nextBalance = current + delta;
  const db = getHotDb();
  const now = nowMs();
  await db.batch([
    db.prepare(
      `INSERT INTO native_user_points (user_id, balance, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         balance = excluded.balance,
         updated_at = excluded.updated_at`,
    ).bind(userId, nextBalance, now),
    db.prepare(
      `INSERT OR REPLACE INTO native_user_point_logs
       (id, user_id, amount, source, description, balance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(logId, userId, delta, source, description, nextBalance, createdAt),
  ]);

  return { success: true, balance: nextBalance };
}

export async function getNativeDailyGamePoints(
  userId: number,
  statDate: string,
): Promise<number> {
  await ensureHotSchema();
  const row = await getHotDb()
    .prepare(
      `SELECT earned_points AS earnedPoints
       FROM native_user_daily_game_points
       WHERE user_id = ? AND stat_date = ?`,
    )
    .bind(userId, statDate)
    .first<{ earnedPoints: number }>();
  return row?.earnedPoints ?? 0;
}

export async function addNativeGamePointsWithLimit(
  userId: number,
  score: number,
  dailyLimit: number,
  source: PointsSource,
  description: string,
  logId: string,
  createdAt: number = nowMs(),
): Promise<{
  success: boolean;
  pointsEarned: number;
  balance: number;
  dailyEarned: number;
  limitReached: boolean;
}> {
  await ensureHotSchema();
  const statDate = getTodayDateString();
  const dailyEarned = await getNativeDailyGamePoints(userId, statDate);
  const grant = Math.max(0, Math.min(score, Math.max(0, dailyLimit - dailyEarned)));
  const currentBalance = await getNativeUserPoints(userId);
  const nextBalance = currentBalance + grant;
  const nextDailyEarned = dailyEarned + grant;
  const db = getHotDb();
  const now = nowMs();

  if (grant > 0) {
    await db.batch([
      db.prepare(
        `INSERT INTO native_user_points (user_id, balance, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           balance = excluded.balance,
           updated_at = excluded.updated_at`,
      ).bind(userId, nextBalance, now),
      db.prepare(
        `INSERT INTO native_user_daily_game_points (user_id, stat_date, earned_points, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, stat_date) DO UPDATE SET
           earned_points = excluded.earned_points,
           updated_at = excluded.updated_at`,
      ).bind(userId, statDate, nextDailyEarned, now),
      db.prepare(
        `INSERT OR REPLACE INTO native_user_point_logs
         (id, user_id, amount, source, description, balance, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(logId, userId, grant, source, description, nextBalance, createdAt),
    ]);
  }

  return {
    success: true,
    pointsEarned: grant,
    balance: nextBalance,
    dailyEarned: nextDailyEarned,
    limitReached: nextDailyEarned >= dailyLimit,
  };
}

export async function getNativeDailyStats(
  userId: number,
  statDate: string = getTodayDateString(),
): Promise<DailyGameStats> {
  await ensureHotSchema();
  const row = await getHotDb()
    .prepare(
      `SELECT games_played AS gamesPlayed, total_score AS totalScore,
              points_earned AS pointsEarned, last_game_at AS lastGameAt
       FROM native_game_daily_stats
       WHERE user_id = ? AND stat_date = ?`,
    )
    .bind(userId, statDate)
    .first<{
      gamesPlayed: number;
      totalScore: number;
      pointsEarned: number;
      lastGameAt: number;
    }>();

  return {
    userId,
    date: statDate,
    gamesPlayed: row?.gamesPlayed ?? 0,
    totalScore: row?.totalScore ?? 0,
    pointsEarned: row?.pointsEarned ?? 0,
    lastGameAt: row?.lastGameAt ?? 0,
  };
}

export async function incrementNativeDailyStats(
  userId: number,
  statDate: string,
  scoreDelta: number,
  cumulativePointsEarned: number,
  timestamp: number = nowMs(),
): Promise<DailyGameStats> {
  await ensureHotSchema();
  const row = await getHotDb()
    .prepare(
      `INSERT INTO native_game_daily_stats
       (user_id, stat_date, games_played, total_score, points_earned, last_game_at)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(user_id, stat_date) DO UPDATE SET
         games_played = native_game_daily_stats.games_played + 1,
         total_score = native_game_daily_stats.total_score + excluded.total_score,
         points_earned = MAX(native_game_daily_stats.points_earned, excluded.points_earned),
         last_game_at = excluded.last_game_at
       RETURNING games_played AS gamesPlayed, total_score AS totalScore,
                 points_earned AS pointsEarned, last_game_at AS lastGameAt`,
    )
    .bind(userId, statDate, scoreDelta, cumulativePointsEarned, timestamp)
    .first<{
      gamesPlayed: number;
      totalScore: number;
      pointsEarned: number;
      lastGameAt: number;
    }>();

  return {
    userId,
    date: statDate,
    gamesPlayed: row?.gamesPlayed ?? 1,
    totalScore: row?.totalScore ?? scoreDelta,
    pointsEarned: row?.pointsEarned ?? cumulativePointsEarned,
    lastGameAt: row?.lastGameAt ?? timestamp,
  };
}

export async function getNativeGameCooldownRemaining(
  userId: number,
  gameType: GameType,
): Promise<number> {
  await ensureHotSchema();
  const now = nowMs();
  const row = await getHotDb()
    .prepare(
      `SELECT expires_at AS expiresAt
       FROM native_game_cooldowns
       WHERE user_id = ? AND game_type = ?`,
    )
    .bind(userId, gameType)
    .first<{ expiresAt: number }>();

  if (!row) {
    return 0;
  }

  if (row.expiresAt <= now) {
    await getHotDb()
      .prepare("DELETE FROM native_game_cooldowns WHERE user_id = ? AND game_type = ?")
      .bind(userId, gameType)
      .run();
    return 0;
  }

  return Math.ceil((row.expiresAt - now) / 1000);
}

export async function setNativeGameCooldown(
  userId: number,
  gameType: GameType,
  ttlSeconds: number,
): Promise<void> {
  await ensureHotSchema();
  const expiresAt = nowMs() + ttlSeconds * 1000;
  await getHotDb()
    .prepare(
      `INSERT INTO native_game_cooldowns (user_id, game_type, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, game_type) DO UPDATE SET
         expires_at = excluded.expires_at`,
    )
    .bind(userId, gameType, expiresAt)
    .run();
}

export async function getNativeGameSession<T>(sessionId: string): Promise<T | null> {
  await ensureHotSchema();
  const row = await getHotDb()
    .prepare(
      `SELECT payload_json AS payloadJson, expires_at AS expiresAt
       FROM native_game_sessions
       WHERE session_id = ?`,
    )
    .bind(sessionId)
    .first<{ payloadJson: string; expiresAt: number }>();

  if (!row) {
    return null;
  }

  if (row.expiresAt <= nowMs()) {
    await getHotDb()
      .prepare("DELETE FROM native_game_sessions WHERE session_id = ?")
      .bind(sessionId)
      .run();
    return null;
  }

  return deserialize<T>(row.payloadJson);
}

export async function getNativeActiveGameSession<T>(
  userId: number,
  gameType: GameType,
): Promise<T | null> {
  await ensureHotSchema();
  const now = nowMs();
  const row = await getHotDb()
    .prepare(
      `SELECT s.payload_json AS payloadJson, s.session_id AS sessionId, a.expires_at AS expiresAt
       FROM native_game_active_sessions a
       JOIN native_game_sessions s ON s.session_id = a.session_id
       WHERE a.user_id = ? AND a.game_type = ?
       LIMIT 1`,
    )
    .bind(userId, gameType)
    .first<{ payloadJson: string; sessionId: string; expiresAt: number }>();

  if (!row) {
    return null;
  }

  if (row.expiresAt <= now) {
    const db = getHotDb();
    await db.batch([
      db.prepare(
        "DELETE FROM native_game_active_sessions WHERE user_id = ? AND game_type = ?",
      ).bind(userId, gameType),
      db.prepare("DELETE FROM native_game_sessions WHERE session_id = ?").bind(row.sessionId),
    ]);
    return null;
  }

  return deserialize<T>(row.payloadJson);
}

export async function createNativeGameSession<T extends {
  id: string;
  userId: number;
  gameType: GameType;
  startedAt: number;
  expiresAt: number;
  status: string;
}>(
  session: T,
): Promise<void> {
  await ensureHotSchema();
  const db = getHotDb();
  await db.batch([
    db.prepare(
      `INSERT OR REPLACE INTO native_game_sessions
       (session_id, user_id, game_type, status, started_at, expires_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      session.id,
      session.userId,
      session.gameType,
      session.status,
      session.startedAt,
      session.expiresAt,
      serialize(session),
    ),
    db.prepare(
      `INSERT INTO native_game_active_sessions (user_id, game_type, session_id, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, game_type) DO UPDATE SET
         session_id = excluded.session_id,
         expires_at = excluded.expires_at`,
    ).bind(session.userId, session.gameType, session.id, session.expiresAt),
  ]);
}

export async function completeNativeGameSettlement<T extends {
  id: string;
  userId: number;
  gameType: GameType;
  score: number;
  pointsEarned: number;
  createdAt: number;
}>(
  record: T,
  sessionId: string,
  scoreDelta: number,
  cumulativePointsEarned: number,
  cooldownSeconds: number,
  options: {
    slotRankingDate?: string;
    slotRankingDelta?: number;
  } = {},
): Promise<void> {
  await ensureHotSchema();
  const db = getHotDb();
  const cooldownExpiresAt = nowMs() + cooldownSeconds * 1000;
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT OR REPLACE INTO native_game_records
       (id, user_id, game_type, score, points_earned, created_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      record.id,
      record.userId,
      record.gameType,
      record.score,
      record.pointsEarned,
      record.createdAt,
      serialize(record),
    ),
    db.prepare("DELETE FROM native_game_sessions WHERE session_id = ?").bind(sessionId),
    db.prepare(
      "DELETE FROM native_game_active_sessions WHERE user_id = ? AND game_type = ?",
    ).bind(record.userId, record.gameType),
    db.prepare(
      `INSERT INTO native_game_cooldowns (user_id, game_type, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, game_type) DO UPDATE SET
         expires_at = excluded.expires_at`,
    ).bind(record.userId, record.gameType, cooldownExpiresAt),
  ];

  if (record.gameType === "slot" && options.slotRankingDate && (options.slotRankingDelta ?? 0) > 0) {
    statements.push(
      db.prepare(
        `INSERT INTO native_slot_daily_rankings (stat_date, user_id, score, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(stat_date, user_id) DO UPDATE SET
           score = native_slot_daily_rankings.score + excluded.score,
           updated_at = excluded.updated_at`,
      ).bind(
        options.slotRankingDate,
        record.userId,
        options.slotRankingDelta ?? 0,
        record.createdAt,
      ),
    );
  }

  await db.batch(statements);
}

export async function cancelNativeGameSession(
  userId: number,
  gameType: GameType,
  cooldownSeconds: number,
): Promise<boolean> {
  await ensureHotSchema();
  const active = await getHotDb()
    .prepare(
      `SELECT session_id AS sessionId
       FROM native_game_active_sessions
       WHERE user_id = ? AND game_type = ?`,
    )
    .bind(userId, gameType)
    .first<{ sessionId: string }>();

  if (!active) {
    return false;
  }

  const cooldownExpiresAt = nowMs() + cooldownSeconds * 1000;
  const db = getHotDb();
  await db.batch([
    db.prepare("DELETE FROM native_game_sessions WHERE session_id = ?").bind(active.sessionId),
    db.prepare(
      "DELETE FROM native_game_active_sessions WHERE user_id = ? AND game_type = ?",
    ).bind(userId, gameType),
    db.prepare(
      `INSERT INTO native_game_cooldowns (user_id, game_type, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, game_type) DO UPDATE SET
         expires_at = excluded.expires_at`,
    ).bind(userId, gameType, cooldownExpiresAt),
  ]);
  return true;
}

export async function listNativeGameRecords<T>(
  userId: number,
  gameType: GameType,
  limit: number,
): Promise<T[]> {
  await ensureHotSchema();
  const rows = await getHotDb()
    .prepare(
      `SELECT payload_json AS payloadJson
       FROM native_game_records
       WHERE user_id = ? AND game_type = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(userId, gameType, limit)
    .all<{ payloadJson: string }>();

  return rows.results
    .map((row) => deserialize<T>(row.payloadJson))
    .filter((item): item is T => item !== null);
}

export async function getNativeRankingCache<T>(cacheKey: string): Promise<T | null> {
  await ensureHotSchema();
  const now = nowMs();
  const row = await getHotDb()
    .prepare(
      `SELECT value_json AS valueJson
       FROM native_ranking_snapshots
       WHERE cache_key = ? AND expires_at > ?`,
    )
    .bind(cacheKey, now)
    .first<{ valueJson: string }>();

  return deserialize<T>(row?.valueJson);
}

export async function setNativeRankingCache<T>(
  cacheKey: string,
  rankingType: string,
  period: string,
  ttlSeconds: number,
  value: T,
): Promise<void> {
  await ensureHotSchema();
  const now = nowMs();
  await getHotDb()
    .prepare(
      `INSERT INTO native_ranking_snapshots
       (cache_key, ranking_type, period, generated_at, expires_at, value_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         ranking_type = excluded.ranking_type,
         period = excluded.period,
         generated_at = excluded.generated_at,
         expires_at = excluded.expires_at,
         value_json = excluded.value_json`,
    )
    .bind(cacheKey, rankingType, period, now, now + ttlSeconds * 1000, serialize(value))
    .run();
}

export async function getNativeGameLeaderboardRows(
  gameType: GameType,
  startAt: number,
  endAt: number,
  limit: number,
): Promise<Array<{
  userId: number;
  username: string;
  totalScore: number;
  totalPoints: number;
  bestScore: number;
  gamesPlayed: number;
}>> {
  await ensureHotSchema();
  if (!GAME_RECORD_TABLE_TYPES.has(gameType)) {
    return [];
  }

  const rows = await getHotDb()
    .prepare(
      `SELECT
         r.user_id AS userId,
         COALESCE(u.username, '#' || r.user_id) AS username,
         SUM(r.score) AS totalScore,
         SUM(r.points_earned) AS totalPoints,
         MAX(r.score) AS bestScore,
         COUNT(*) AS gamesPlayed
       FROM native_game_records r
       LEFT JOIN native_users u ON u.user_id = r.user_id
       WHERE r.game_type = ? AND r.created_at >= ? AND r.created_at < ?
       GROUP BY r.user_id
       ORDER BY totalScore DESC, totalPoints DESC, gamesPlayed DESC, r.user_id ASC
       LIMIT ?`,
    )
    .bind(gameType, startAt, endAt, limit)
    .all<{
      userId: number;
      username: string;
      totalScore: number;
      totalPoints: number;
      bestScore: number;
      gamesPlayed: number;
    }>();

  return rows.results;
}

export async function getNativeOverallBreakdownRows(
  startAt: number,
  endAt: number,
): Promise<Array<{
  userId: number;
  username: string;
  gameType: GameType;
  totalScore: number;
  totalPoints: number;
  gamesPlayed: number;
}>> {
  await ensureHotSchema();
  const rows = await getHotDb()
    .prepare(
      `SELECT
         r.user_id AS userId,
         COALESCE(u.username, '#' || r.user_id) AS username,
         r.game_type AS gameType,
         SUM(r.score) AS totalScore,
         SUM(r.points_earned) AS totalPoints,
         COUNT(*) AS gamesPlayed
       FROM native_game_records r
       LEFT JOIN native_users u ON u.user_id = r.user_id
       WHERE r.created_at >= ? AND r.created_at < ?
       GROUP BY r.user_id, r.game_type`,
    )
    .bind(startAt, endAt)
    .all<{
      userId: number;
      username: string;
      gameType: GameType;
      totalScore: number;
      totalPoints: number;
      gamesPlayed: number;
    }>();

  return rows.results;
}

export async function getNativePointsLeaderboardRows(
  period: "all" | "monthly",
  startAt: number,
  limit: number,
): Promise<Array<{ userId: number; username: string; points: number }>> {
  await ensureHotSchema();
  const db = getHotDb();
  const query = period === "all"
    ? db.prepare(
      `SELECT
         p.user_id AS userId,
         COALESCE(u.username, '#' || p.user_id) AS username,
         p.balance AS points
       FROM native_user_points p
       LEFT JOIN native_users u ON u.user_id = p.user_id
       ORDER BY p.balance DESC, p.user_id ASC
       LIMIT ?`,
    ).bind(limit)
    : db.prepare(
      `SELECT
         l.user_id AS userId,
         COALESCE(u.username, '#' || l.user_id) AS username,
         SUM(l.amount) AS points
       FROM native_user_point_logs l
       LEFT JOIN native_users u ON u.user_id = l.user_id
       WHERE l.created_at >= ?
       GROUP BY l.user_id
       ORDER BY points DESC, l.user_id ASC
       LIMIT ?`,
    ).bind(startAt, limit);

  const rows = await query.all<{ userId: number; username: string; points: number }>();
  return rows.results;
}

export async function getNativeCheckinEntries(
  startDate: string,
  endDate?: string,
): Promise<Array<{ userId: number; username: string; checkinDate: string }>> {
  await ensureHotSchema();
  const db = getHotDb();
  const rows = endDate
    ? await db.prepare(
      `SELECT
         c.user_id AS userId,
         COALESCE(u.username, '#' || c.user_id) AS username,
         c.checkin_date AS checkinDate
       FROM native_user_checkins c
       LEFT JOIN native_users u ON u.user_id = c.user_id
       WHERE c.checkin_date >= ? AND c.checkin_date <= ?
       ORDER BY c.user_id ASC, c.checkin_date DESC`,
    ).bind(startDate, endDate).all<{ userId: number; username: string; checkinDate: string }>()
    : await db.prepare(
      `SELECT
         c.user_id AS userId,
         COALESCE(u.username, '#' || c.user_id) AS username,
         c.checkin_date AS checkinDate
       FROM native_user_checkins c
       LEFT JOIN native_users u ON u.user_id = c.user_id
       WHERE c.checkin_date >= ?
       ORDER BY c.user_id ASC, c.checkin_date DESC`,
    ).bind(startDate).all<{ userId: number; username: string; checkinDate: string }>();

  return rows.results;
}

export async function listNativeSlotDailyRanking(
  date: string,
  limit: number,
): Promise<Array<{ userId: number; username: string; score: number }>> {
  await ensureHotSchema();
  const rows = await getHotDb()
    .prepare(
      `SELECT
         r.user_id AS userId,
         COALESCE(u.username, '#' || r.user_id) AS username,
         r.score AS score
       FROM native_slot_daily_rankings r
       LEFT JOIN native_users u ON u.user_id = r.user_id
       WHERE r.stat_date = ?
       ORDER BY r.score DESC, r.user_id ASC
       LIMIT ?`,
    )
    .bind(date, limit)
    .all<{ userId: number; username: string; score: number }>();

  return rows.results;
}

export async function getNativeSettlementRecord(
  period: "weekly" | "monthly",
  periodStart: number,
  periodEnd: number,
): Promise<NativeSettlementRecordPayload | null> {
  await ensureHotSchema();
  const row = await getHotDb()
    .prepare(
      `SELECT *
       FROM native_ranking_settlements
       WHERE period = ? AND period_start = ? AND period_end = ?
       LIMIT 1`,
    )
    .bind(period, periodStart, periodEnd)
    .first<{
      id: string;
      period: "weekly" | "monthly";
      period_start: number;
      period_end: number;
      period_label: string;
      status: "success" | "partial" | "failed";
      reward_policy_json: string;
      total_participants: number;
      rewards_json: string;
      summary_json: string;
      created_at: number;
      settled_at: number;
      retry_count: number;
      triggered_by_json: string;
    }>();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    period: row.period,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    periodLabel: row.period_label,
    status: row.status,
    rewardPolicy: deserialize(row.reward_policy_json),
    totalParticipants: row.total_participants,
    rewards: deserialize<unknown[]>(row.rewards_json) ?? [],
    summary: deserialize(row.summary_json),
    createdAt: row.created_at,
    settledAt: row.settled_at,
    retryCount: row.retry_count,
    triggeredBy: deserialize(row.triggered_by_json),
  };
}

export async function saveNativeSettlementRecord(
  record: NativeSettlementRecordPayload,
): Promise<void> {
  await ensureHotSchema();
  await getHotDb()
    .prepare(
      `INSERT INTO native_ranking_settlements
       (id, period, period_start, period_end, period_label, status,
        reward_policy_json, total_participants, rewards_json, summary_json,
        created_at, settled_at, retry_count, triggered_by_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(period, period_start, period_end) DO UPDATE SET
         id = excluded.id,
         period_label = excluded.period_label,
         status = excluded.status,
         reward_policy_json = excluded.reward_policy_json,
         total_participants = excluded.total_participants,
         rewards_json = excluded.rewards_json,
         summary_json = excluded.summary_json,
         created_at = excluded.created_at,
         settled_at = excluded.settled_at,
         retry_count = excluded.retry_count,
         triggered_by_json = excluded.triggered_by_json`,
    )
    .bind(
      record.id,
      record.period,
      record.periodStart,
      record.periodEnd,
      record.periodLabel,
      record.status,
      serialize(record.rewardPolicy),
      record.totalParticipants,
      serialize(record.rewards),
      serialize(record.summary),
      record.createdAt,
      record.settledAt,
      record.retryCount,
      serialize(record.triggeredBy),
    )
    .run();
}

export async function listNativeSettlementHistory(
  period: "weekly" | "monthly",
  offset: number,
  limit: number,
): Promise<{ total: number; items: NativeSettlementRecordPayload[] }> {
  await ensureHotSchema();
  const db = getHotDb();
  const [countRow, rows] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS total
       FROM native_ranking_settlements
       WHERE period = ?`,
    ).bind(period).first<{ total: number }>(),
    db.prepare(
      `SELECT *
       FROM native_ranking_settlements
       WHERE period = ?
       ORDER BY period_end DESC
       LIMIT ? OFFSET ?`,
    ).bind(period, limit, offset).all<{
      id: string;
      period: "weekly" | "monthly";
      period_start: number;
      period_end: number;
      period_label: string;
      status: "success" | "partial" | "failed";
      reward_policy_json: string;
      total_participants: number;
      rewards_json: string;
      summary_json: string;
      created_at: number;
      settled_at: number;
      retry_count: number;
      triggered_by_json: string;
    }>(),
  ]);

  return {
    total: countRow?.total ?? 0,
    items: rows.results.map((row) => ({
      id: row.id,
      period: row.period,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      periodLabel: row.period_label,
      status: row.status,
      rewardPolicy: deserialize(row.reward_policy_json),
      totalParticipants: row.total_participants,
      rewards: deserialize<unknown[]>(row.rewards_json) ?? [],
      summary: deserialize(row.summary_json),
      createdAt: row.created_at,
      settledAt: row.settled_at,
      retryCount: row.retry_count,
      triggeredBy: deserialize(row.triggered_by_json),
    })),
  };
}

export async function tryClaimNativeSettlementReward(
  period: "weekly" | "monthly",
  periodStart: number,
  periodEnd: number,
  userId: number,
  processedAt: number,
): Promise<boolean> {
  await ensureHotSchema();
  const row = await getHotDb()
    .prepare(
      `INSERT INTO native_ranking_reward_claims
       (period, period_start, period_end, user_id, processed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(period, period_start, period_end, user_id) DO NOTHING
       RETURNING user_id AS userId`,
    )
    .bind(period, periodStart, periodEnd, userId, processedAt)
    .first<{ userId: number }>();
  return !!row;
}

export async function releaseNativeSettlementRewardClaim(
  period: "weekly" | "monthly",
  periodStart: number,
  periodEnd: number,
  userId: number,
): Promise<void> {
  await ensureHotSchema();
  await getHotDb()
    .prepare(
      `DELETE FROM native_ranking_reward_claims
       WHERE period = ? AND period_start = ? AND period_end = ? AND user_id = ?`,
    )
    .bind(period, periodStart, periodEnd, userId)
    .run();
}

export async function resetNativeHotStoreData(): Promise<void> {
  await ensureHotSchema();
  const db = getHotDb();
  const tables = [
    "native_auth_session_blacklist",
    "native_auth_session_revocations",
    "native_auth_login_failures",
    "native_rate_limit_counters",
    "native_distributed_locks",
    "native_user_assets",
    "native_user_cards",
    "native_user_checkins",
    "native_user_points",
    "native_user_point_logs",
    "native_user_daily_game_points",
    "native_game_sessions",
    "native_game_active_sessions",
    "native_game_cooldowns",
    "native_game_records",
    "native_game_daily_stats",
    "native_slot_daily_rankings",
    "native_ranking_snapshots",
    "native_ranking_settlements",
    "native_ranking_reward_claims",
    "native_users",
  ];

  for (const table of tables) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }

  await setNativeHotStoreReady(false);
}

export async function replaceNativeUserCheckins(
  userId: number,
  entries: Array<{ date: string; quotaAwarded?: number; createdAt?: number }>,
): Promise<void> {
  await ensureHotSchema();
  const db = getHotDb();
  await db.prepare("DELETE FROM native_user_checkins WHERE user_id = ?").bind(userId).run();
  if (entries.length === 0) {
    return;
  }

  await db.batch(entries.map((entry) =>
    db.prepare(
      `INSERT INTO native_user_checkins (user_id, checkin_date, quota_awarded, created_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(
      userId,
      entry.date,
      entry.quotaAwarded ?? 0,
      entry.createdAt ?? nowMs(),
    )
  ));
}

export async function replaceNativePointLogs(
  userId: number,
  logs: PointsLog[],
): Promise<void> {
  await ensureHotSchema();
  const db = getHotDb();
  await db.prepare("DELETE FROM native_user_point_logs WHERE user_id = ?").bind(userId).run();
  if (logs.length === 0) {
    return;
  }

  await db.batch(logs.map((log) =>
    db.prepare(
      `INSERT OR REPLACE INTO native_user_point_logs
       (id, user_id, amount, source, description, balance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      log.id,
      userId,
      log.amount,
      log.source,
      log.description,
      log.balance,
      log.createdAt,
    )
  ));
}

export async function replaceNativeGameRecords<T extends {
  id: string;
  userId: number;
  gameType: GameType;
  score?: number;
  pointsEarned?: number;
  createdAt?: number;
}>(
  userId: number,
  gameType: GameType,
  records: T[],
): Promise<void> {
  await ensureHotSchema();
  const db = getHotDb();
  await db
    .prepare("DELETE FROM native_game_records WHERE user_id = ? AND game_type = ?")
    .bind(userId, gameType)
    .run();
  if (records.length === 0) {
    return;
  }

  await db.batch(records.map((record) =>
    db.prepare(
      `INSERT OR REPLACE INTO native_game_records
       (id, user_id, game_type, score, points_earned, created_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      record.id,
      userId,
      gameType,
      Math.floor(Number(record.score ?? 0)),
      Math.floor(Number(record.pointsEarned ?? 0)),
      Math.floor(Number(record.createdAt ?? nowMs())),
      serialize(record),
    )
  ));
}

export async function replaceNativeDailyStats(
  userId: number,
  statsList: DailyGameStats[],
): Promise<void> {
  await ensureHotSchema();
  const db = getHotDb();
  await db
    .prepare("DELETE FROM native_game_daily_stats WHERE user_id = ?")
    .bind(userId)
    .run();
  if (statsList.length === 0) {
    return;
  }

  await db.batch(statsList.map((stats) =>
    db.prepare(
      `INSERT INTO native_game_daily_stats
       (user_id, stat_date, games_played, total_score, points_earned, last_game_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      userId,
      stats.date,
      stats.gamesPlayed,
      stats.totalScore,
      stats.pointsEarned,
      stats.lastGameAt,
    )
  ));
}

export async function replaceNativeDailyGamePoints(
  userId: number,
  entries: Array<{ date: string; earnedPoints: number }>,
): Promise<void> {
  await ensureHotSchema();
  const db = getHotDb();
  await db
    .prepare("DELETE FROM native_user_daily_game_points WHERE user_id = ?")
    .bind(userId)
    .run();
  if (entries.length === 0) {
    return;
  }

  await db.batch(entries.map((entry) =>
    db.prepare(
      `INSERT INTO native_user_daily_game_points
       (user_id, stat_date, earned_points, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(
      userId,
      entry.date,
      entry.earnedPoints,
      nowMs(),
    )
  ));
}

export async function replaceNativeSlotDailyScores(
  date: string,
  entries: Array<{ userId: number; score: number }>,
): Promise<void> {
  await ensureHotSchema();
  const db = getHotDb();
  await db.prepare("DELETE FROM native_slot_daily_rankings WHERE stat_date = ?").bind(date).run();
  if (entries.length === 0) {
    return;
  }

  await db.batch(entries.map((entry) =>
    db.prepare(
      `INSERT INTO native_slot_daily_rankings (stat_date, user_id, score, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(date, entry.userId, entry.score, nowMs())
  ));
}

export async function upsertNativeSlotDailyScores(
  date: string,
  entries: Array<{ userId: number; score: number }>,
): Promise<void> {
  await ensureHotSchema();
  if (entries.length === 0) {
    return;
  }

  const db = getHotDb();
  await db.batch(entries.map((entry) =>
    db.prepare(
      `INSERT INTO native_slot_daily_rankings (stat_date, user_id, score, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(stat_date, user_id) DO UPDATE SET
         score = excluded.score,
         updated_at = excluded.updated_at`,
    ).bind(date, entry.userId, entry.score, nowMs())
  ));
}

export async function getLegacyHotMigrationSource(): Promise<{
  users: Array<{ id: number; username: string; firstSeen: number }>;
}> {
  const userIds = await kv.smembers("users:all") as Array<string | number>;
  const ids = userIds
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (ids.length === 0) {
    return { users: [] };
  }

  const users = await kv.mget<{ id: number; username: string; firstSeen: number }>(
    ...ids.map((id) => `user:${id}`),
  );

  return {
    users: (users ?? []).filter((item): item is { id: number; username: string; firstSeen: number } => item !== null),
  };
}
