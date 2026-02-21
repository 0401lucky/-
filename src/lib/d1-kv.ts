// src/lib/d1-kv.ts — Cloudflare D1 adapter with @vercel/kv-compatible API
// Replaces @vercel/kv (Upstash Redis) with D1 (SQLite)

import { getCloudflareContext } from "@opennextjs/cloudflare";

// Minimal D1 type definitions (subset used by this adapter)
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

let _db: D1DatabaseLike | null = null;
let _secondaryExpiryTableReady = false;
let _secondaryExpiryTableInitPromise: Promise<void> | null = null;

function getD1(): D1DatabaseLike {
  if (_db) return _db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (getCloudflareContext as any)?.();
  const env = ctx?.env as CloudflareEnv | undefined;
  if (!env?.KV_DB) {
    throw new Error("D1 binding KV_DB not available");
  }
  _db = env.KV_DB as unknown as D1DatabaseLike;
  return _db;
}

/** Reset cached binding (for testing). */
export function __resetD1(): void {
  _db = null;
  _secondaryExpiryTableReady = false;
  _secondaryExpiryTableInitPromise = null;
}

// ---------- helpers ----------

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function deserialize<T>(raw: string | null | undefined): T | null {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

function nowMs(): number {
  return Date.now();
}

function isExpired(expiresAt: number | null | undefined): boolean {
  if (expiresAt === null || expiresAt === undefined) return false;
  return nowMs() >= expiresAt;
}

function placeholders(size: number): string {
  return Array.from({ length: size }, () => "?").join(",");
}

async function ensureSecondaryExpiryTable(db: D1DatabaseLike): Promise<void> {
  if (_secondaryExpiryTableReady) {
    return;
  }

  if (!_secondaryExpiryTableInitPromise) {
    _secondaryExpiryTableInitPromise = (async () => {
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS kv_key_expirations (
            key TEXT PRIMARY KEY,
            expires_at INTEGER NOT NULL
          )`,
        )
        .run();
      await db
        .prepare(
          "CREATE INDEX IF NOT EXISTS idx_kv_key_expirations_expires_at ON kv_key_expirations(expires_at)",
        )
        .run();
      _secondaryExpiryTableReady = true;
    })();
  }

  await _secondaryExpiryTableInitPromise;
}

async function deleteKeyAcrossTables(db: D1DatabaseLike, key: string): Promise<void> {
  await ensureSecondaryExpiryTable(db);
  await db.batch([
    db.prepare("DELETE FROM kv_data WHERE key = ?").bind(key),
    db.prepare("DELETE FROM kv_lists WHERE key = ?").bind(key),
    db.prepare("DELETE FROM kv_sets WHERE key = ?").bind(key),
    db.prepare("DELETE FROM kv_zsets WHERE key = ?").bind(key),
    db.prepare("DELETE FROM kv_hashes WHERE key = ?").bind(key),
    db.prepare("DELETE FROM kv_key_expirations WHERE key = ?").bind(key),
  ]);
}

async function hasNonStringKeyData(db: D1DatabaseLike, key: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM kv_lists WHERE key = ?
       UNION ALL
       SELECT 1 AS ok FROM kv_sets WHERE key = ?
       UNION ALL
       SELECT 1 AS ok FROM kv_zsets WHERE key = ?
       UNION ALL
       SELECT 1 AS ok FROM kv_hashes WHERE key = ?
       LIMIT 1`,
    )
    .bind(key, key, key, key)
    .first<{ ok: number }>();
  return !!row;
}

async function getSecondaryExpiry(db: D1DatabaseLike, key: string): Promise<number | null> {
  await ensureSecondaryExpiryTable(db);
  const row = await db
    .prepare("SELECT expires_at FROM kv_key_expirations WHERE key = ?")
    .bind(key)
    .first<{ expires_at: number }>();
  return row?.expires_at ?? null;
}

async function setSecondaryExpiry(db: D1DatabaseLike, key: string, expiresAt: number): Promise<void> {
  await ensureSecondaryExpiryTable(db);
  await db
    .prepare(
      `INSERT INTO kv_key_expirations (key, expires_at) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET expires_at = excluded.expires_at`,
    )
    .bind(key, expiresAt)
    .run();
}

async function clearSecondaryExpiry(db: D1DatabaseLike, key: string): Promise<void> {
  await ensureSecondaryExpiryTable(db);
  await db.prepare("DELETE FROM kv_key_expirations WHERE key = ?").bind(key).run();
}

async function purgeIfExpired(db: D1DatabaseLike, key: string): Promise<boolean> {
  const secondaryExpiry = await getSecondaryExpiry(db, key);
  if (secondaryExpiry === null) {
    return false;
  }

  if (!isExpired(secondaryExpiry)) {
    return false;
  }

  await deleteKeyAcrossTables(db, key);
  return true;
}

async function keyExists(db: D1DatabaseLike, key: string): Promise<boolean> {
  const dataRow = await db
    .prepare("SELECT expires_at FROM kv_data WHERE key = ?")
    .bind(key)
    .first<{ expires_at: number | null }>();
  if (dataRow) {
    if (isExpired(dataRow.expires_at)) {
      await deleteKeyAcrossTables(db, key);
      return false;
    }
    return true;
  }

  if (await purgeIfExpired(db, key)) {
    return false;
  }

  return hasNonStringKeyData(db, key);
}

// ---------- kv object ----------

export const kv = {
  // ==================== String commands ====================

  async get<T = unknown>(key: string): Promise<T | null> {
    const db = getD1();
    if (await purgeIfExpired(db, key)) {
      return null;
    }
    const row = await db
      .prepare("SELECT value, expires_at FROM kv_data WHERE key = ?")
      .bind(key)
      .first<{ value: string; expires_at: number | null }>();
    if (!row) return null;
    if (isExpired(row.expires_at)) {
      await deleteKeyAcrossTables(db, key);
      return null;
    }
    return deserialize<T>(row.value);
  },

  async set(
    key: string,
    value: unknown,
    options?: { ex?: number; nx?: boolean },
  ): Promise<string | null> {
    const db = getD1();
    const serialized = serialize(value);
    const expiresAt =
      options?.ex != null ? nowMs() + options.ex * 1000 : null;

    if (options?.nx) {
      if (await purgeIfExpired(db, key)) {
        // 已过期并清理，继续抢占写入
      }

      if (await hasNonStringKeyData(db, key)) {
        return null;
      }

      const now = nowMs();
      const setResult = await db
        .prepare(
          `INSERT INTO kv_data (key, value, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             expires_at = excluded.expires_at
           WHERE kv_data.expires_at IS NOT NULL AND kv_data.expires_at <= ?
           RETURNING key`,
        )
        .bind(key, serialized, expiresAt, now)
        .first<{ key: string }>();
      if (!setResult) {
        return null;
      }
      await clearSecondaryExpiry(db, key);
      return "OK";
    }

    await deleteKeyAcrossTables(db, key);
    await db
      .prepare(
        "INSERT OR REPLACE INTO kv_data (key, value, expires_at) VALUES (?, ?, ?)",
      )
      .bind(key, serialized, expiresAt)
      .run();
    await clearSecondaryExpiry(db, key);
    return "OK";
  },

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const db = getD1();
    await ensureSecondaryExpiryTable(db);
    const keyPlaceholders = placeholders(keys.length);
    const stmts = [
      db.prepare(`DELETE FROM kv_data WHERE key IN (${keyPlaceholders})`).bind(...keys),
      db.prepare(`DELETE FROM kv_lists WHERE key IN (${keyPlaceholders})`).bind(...keys),
      db.prepare(`DELETE FROM kv_sets WHERE key IN (${keyPlaceholders})`).bind(...keys),
      db.prepare(`DELETE FROM kv_zsets WHERE key IN (${keyPlaceholders})`).bind(...keys),
      db.prepare(`DELETE FROM kv_hashes WHERE key IN (${keyPlaceholders})`).bind(...keys),
      db.prepare(`DELETE FROM kv_key_expirations WHERE key IN (${keyPlaceholders})`).bind(...keys),
    ];
    const results = await db.batch(stmts);
    let total = 0;
    for (const r of results) {
      total += (r.meta?.changes ?? 0);
    }
    return total > 0 ? total : 0;
  },

  async mget<T = unknown>(...keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    const db = getD1();
    const keyPlaceholders = placeholders(keys.length);
    const rows = await db
      .prepare(
        `SELECT key, value, expires_at FROM kv_data WHERE key IN (${keyPlaceholders})`,
      )
      .bind(...keys)
      .all<{ key: string; value: string; expires_at: number | null }>();

    const map = new Map<string, string>();
    const expiredKeys: string[] = [];
    for (const row of rows.results) {
      if (isExpired(row.expires_at)) {
        expiredKeys.push(row.key);
      } else {
        map.set(row.key, row.value);
      }
    }
    // Lazy cleanup
    if (expiredKeys.length > 0) {
      await ensureSecondaryExpiryTable(db);
      const ep = placeholders(expiredKeys.length);
      await db.batch([
        db.prepare(`DELETE FROM kv_data WHERE key IN (${ep})`).bind(...expiredKeys),
        db.prepare(`DELETE FROM kv_key_expirations WHERE key IN (${ep})`).bind(...expiredKeys),
      ]);
    }

    return keys.map((k) => {
      const raw = map.get(k);
      if (raw === undefined) return null;
      return deserialize<T>(raw);
    });
  },

  async incr(key: string): Promise<number> {
    return kv.incrby(key, 1);
  },

  async incrby(key: string, increment: number): Promise<number> {
    const db = getD1();
    await purgeIfExpired(db, key);
    await clearSecondaryExpiry(db, key);
    // Clean up expired key first
    await db
      .prepare("DELETE FROM kv_data WHERE key = ? AND expires_at IS NOT NULL AND expires_at < ?")
      .bind(key, nowMs())
      .run();

    const result = await db
      .prepare(
        `INSERT INTO kv_data (key, value, expires_at) VALUES (?, ?, NULL)
         ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT)
         RETURNING CAST(value AS INTEGER) AS num`,
      )
      .bind(key, String(increment), increment)
      .first<{ num: number }>();
    return result?.num ?? increment;
  },

  async decrby(key: string, decrement: number): Promise<number> {
    return kv.incrby(key, -decrement);
  },

  async decr(key: string): Promise<number> {
    return kv.incrby(key, -1);
  },

  async ttl(key: string): Promise<number> {
    const db = getD1();
    const row = await db
      .prepare("SELECT expires_at FROM kv_data WHERE key = ?")
      .bind(key)
      .first<{ expires_at: number | null }>();
    if (row) {
      if (row.expires_at === null) return -1; // no expiry
      const remaining = Math.ceil((row.expires_at - nowMs()) / 1000);
      if (remaining <= 0) {
        await deleteKeyAcrossTables(db, key);
        return -2;
      }
      return remaining;
    }

    const secondaryExpiry = await getSecondaryExpiry(db, key);
    if (secondaryExpiry === null) {
      const hasComplexData = await hasNonStringKeyData(db, key);
      return hasComplexData ? -1 : -2;
    }

    const secondaryRemaining = Math.ceil((secondaryExpiry - nowMs()) / 1000);
    if (secondaryRemaining <= 0) {
      await deleteKeyAcrossTables(db, key);
      return -2;
    }

    if (!(await hasNonStringKeyData(db, key))) {
      await clearSecondaryExpiry(db, key);
      return -2;
    }

    return secondaryRemaining;
  },

  async expire(key: string, seconds: number): Promise<number> {
    const db = getD1();
    if (seconds <= 0) {
      const existed = await keyExists(db, key);
      if (!existed) {
        return 0;
      }
      await deleteKeyAcrossTables(db, key);
      return 1;
    }

    if (await purgeIfExpired(db, key)) {
      return 0;
    }
    const expiresAt = nowMs() + seconds * 1000;
    const result = await db
      .prepare("UPDATE kv_data SET expires_at = ? WHERE key = ?")
      .bind(expiresAt, key)
      .run();
    if ((result.meta?.changes ?? 0) > 0) {
      await clearSecondaryExpiry(db, key);
      return 1;
    }

    if (!(await hasNonStringKeyData(db, key))) {
      return 0;
    }

    await setSecondaryExpiry(db, key, expiresAt);
    return 1;
  },

  async exists(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const db = getD1();
    let count = 0;
    for (const key of keys) {
      if (await keyExists(db, key)) {
        count += 1;
      }
    }
    return count;
  },

  // ==================== List commands ====================

  async lpush(key: string, ...values: unknown[]): Promise<number> {
    if (values.length === 0) return 0;
    const db = getD1();
    await purgeIfExpired(db, key);
    const stmts = values.map((v) =>
      db
        .prepare("INSERT INTO kv_lists (key, value) VALUES (?, ?)")
        .bind(key, serialize(v)),
    );
    await db.batch(stmts);
    const row = await db
      .prepare("SELECT COUNT(*) AS cnt FROM kv_lists WHERE key = ?")
      .bind(key)
      .first<{ cnt: number }>();
    return row?.cnt ?? values.length;
  },

  async rpop(key: string): Promise<string | null> {
    const db = getD1();
    await purgeIfExpired(db, key);
    // rpop = remove lowest id (oldest inserted) — matching Redis RPOP on a list where LPUSH adds to head
    const row = await db
      .prepare(
        "DELETE FROM kv_lists WHERE id = (SELECT id FROM kv_lists WHERE key = ? ORDER BY id ASC LIMIT 1) RETURNING value",
      )
      .bind(key)
      .first<{ value: string }>();
    if (!row) return null;
    return deserialize<string>(row.value);
  },

  async lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]> {
    const db = getD1();
    await purgeIfExpired(db, key);
    // Get total count for negative index support
    const countRow = await db
      .prepare("SELECT COUNT(*) AS cnt FROM kv_lists WHERE key = ?")
      .bind(key)
      .first<{ cnt: number }>();
    const total = countRow?.cnt ?? 0;
    if (total === 0) return [];

    // Normalize negative indices
    const s = start < 0 ? Math.max(0, total + start) : start;
    let e = stop < 0 ? total + stop : stop;
    if (e >= total) e = total - 1;
    if (s > e) return [];

    const limit = e - s + 1;

    // Order by id DESC = LPUSH head first (Redis semantics)
    const rows = await db
      .prepare(
        "SELECT value FROM kv_lists WHERE key = ? ORDER BY id DESC LIMIT ? OFFSET ?",
      )
      .bind(key, limit, s)
      .all<{ value: string }>();

    return rows.results.map((r: { value: string }) => deserialize<T>(r.value)!);
  },

  async llen(key: string): Promise<number> {
    const db = getD1();
    await purgeIfExpired(db, key);
    const row = await db
      .prepare("SELECT COUNT(*) AS cnt FROM kv_lists WHERE key = ?")
      .bind(key)
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  },

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    const db = getD1();
    await purgeIfExpired(db, key);
    // Get all ids ordered by id DESC (LPUSH head first)
    const rows = await db
      .prepare("SELECT id FROM kv_lists WHERE key = ? ORDER BY id DESC")
      .bind(key)
      .all<{ id: number }>();
    const total = rows.results.length;
    if (total === 0) return;

    const s = start < 0 ? Math.max(0, total + start) : start;
    let e = stop < 0 ? total + stop : stop;
    if (e >= total) e = total - 1;

    if (s > e) {
      // Trim everything
      await db.prepare("DELETE FROM kv_lists WHERE key = ?").bind(key).run();
      return;
    }

    const keepIds = new Set(rows.results.slice(s, e + 1).map((r: { id: number }) => r.id));
    const deleteIds = rows.results.filter((r: { id: number }) => !keepIds.has(r.id)).map((r: { id: number }) => r.id);

    if (deleteIds.length > 0) {
      const placeholders = deleteIds.map(() => "?").join(",");
      await db
        .prepare(`DELETE FROM kv_lists WHERE id IN (${placeholders})`)
        .bind(...deleteIds)
        .run();
    }
  },

  async lrem(key: string, count: number, value: unknown): Promise<number> {
    const db = getD1();
    await purgeIfExpired(db, key);
    const serialized = serialize(value);

    if (count === 0) {
      // Remove all matching
      const result = await db
        .prepare("DELETE FROM kv_lists WHERE key = ? AND value = ?")
        .bind(key, serialized)
        .run();
      return result.meta?.changes ?? 0;
    }

    const absCount = Math.abs(count);
    const order = count > 0 ? "DESC" : "ASC"; // count > 0: head first (high id), count < 0: tail first (low id)
    const rows = await db
      .prepare(
        `SELECT id FROM kv_lists WHERE key = ? AND value = ? ORDER BY id ${order} LIMIT ?`,
      )
      .bind(key, serialized, absCount)
      .all<{ id: number }>();

    if (rows.results.length === 0) return 0;

    const ids = rows.results.map((r: { id: number }) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    await db
      .prepare(`DELETE FROM kv_lists WHERE id IN (${placeholders})`)
      .bind(...ids)
      .run();

    return ids.length;
  },

  // ==================== Set commands ====================

  async sadd(key: string, ...members: unknown[]): Promise<number> {
    if (members.length === 0) return 0;
    const db = getD1();
    await purgeIfExpired(db, key);
    const stmts = members.map((m) =>
      db
        .prepare("INSERT OR IGNORE INTO kv_sets (key, member) VALUES (?, ?)")
        .bind(key, String(m)),
    );
    const results = await db.batch(stmts);
    let added = 0;
    for (const r of results) {
      added += (r.meta?.changes ?? 0);
    }
    return added;
  },

  async srem(key: string, ...members: unknown[]): Promise<number> {
    if (members.length === 0) return 0;
    const db = getD1();
    await purgeIfExpired(db, key);
    const placeholders = members.map(() => "?").join(",");
    const result = await db
      .prepare(`DELETE FROM kv_sets WHERE key = ? AND member IN (${placeholders})`)
      .bind(key, ...members.map(String))
      .run();
    return result.meta?.changes ?? 0;
  },

  async scard(key: string): Promise<number> {
    const db = getD1();
    await purgeIfExpired(db, key);
    const row = await db
      .prepare("SELECT COUNT(*) AS cnt FROM kv_sets WHERE key = ?")
      .bind(key)
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  },

  async smembers<T = string>(key: string): Promise<T[]> {
    const db = getD1();
    await purgeIfExpired(db, key);
    const rows = await db
      .prepare("SELECT member FROM kv_sets WHERE key = ?")
      .bind(key)
      .all<{ member: string }>();
    return rows.results.map((r: { member: string }) => r.member as unknown as T);
  },

  async sismember(key: string, member: unknown): Promise<number> {
    const db = getD1();
    await purgeIfExpired(db, key);
    const row = await db
      .prepare("SELECT 1 AS ok FROM kv_sets WHERE key = ? AND member = ?")
      .bind(key, String(member))
      .first<{ ok: number }>();
    return row ? 1 : 0;
  },

  async srandmember(key: string): Promise<string | null> {
    const db = getD1();
    await purgeIfExpired(db, key);
    const row = await db
      .prepare("SELECT member FROM kv_sets WHERE key = ? ORDER BY RANDOM() LIMIT 1")
      .bind(key)
      .first<{ member: string }>();
    return row?.member ?? null;
  },

  // ==================== Sorted Set commands ====================

  async zadd(
    key: string,
    ...items: Array<{ score: number; member: string }>
  ): Promise<number> {
    if (items.length === 0) return 0;
    const db = getD1();
    await purgeIfExpired(db, key);
    const stmts = items.map((item) =>
      db
        .prepare(
          "INSERT OR REPLACE INTO kv_zsets (key, member, score) VALUES (?, ?, ?)",
        )
        .bind(key, item.member, item.score),
    );
    await db.batch(stmts);
    return items.length;
  },

  async zrange<T = string>(
    key: string,
    start: number | string,
    stop: number | string,
    options?: { rev?: boolean; withScores?: boolean; byScore?: boolean; offset?: number; count?: number },
  ): Promise<T[]> {
    const db = getD1();
    await purgeIfExpired(db, key);

    // byScore mode: range by score values
    if (options?.byScore) {
      const minScore = start === '-inf' ? -1e308 : Number(start);
      const maxScore = stop === '+inf' ? 1e308 : Number(stop);
      const order = options.rev ? "DESC" : "ASC";
      const limit = options.count ?? 1000;
      const offset = options.offset ?? 0;

      const rows = await db
        .prepare(
          `SELECT member, score FROM kv_zsets WHERE key = ? AND score >= ? AND score <= ? ORDER BY score ${order}, member ${order} LIMIT ? OFFSET ?`,
        )
        .bind(key, minScore, maxScore, limit, offset)
        .all<{ member: string; score: number }>();

      return rows.results.map((r: { member: string; score: number }) => r.member as unknown as T);
    }

    const countRow = await db
      .prepare("SELECT COUNT(*) AS cnt FROM kv_zsets WHERE key = ?")
      .bind(key)
      .first<{ cnt: number }>();
    const total = countRow?.cnt ?? 0;
    if (total === 0) return [];

    const numStart = Number(start);
    const numStop = Number(stop);
    const s = numStart < 0 ? Math.max(0, total + numStart) : numStart;
    let e = numStop < 0 ? total + numStop : numStop;
    if (e >= total) e = total - 1;
    if (s > e) return [];

    const limit = e - s + 1;
    const order = options?.rev ? "DESC" : "ASC";

    const rows = await db
      .prepare(
        `SELECT member, score FROM kv_zsets WHERE key = ? ORDER BY score ${order}, member ${order} LIMIT ? OFFSET ?`,
      )
      .bind(key, limit, s)
      .all<{ member: string; score: number }>();

    if (options?.withScores) {
      // Return [member, score, member, score, ...] like Redis
      const result: unknown[] = [];
      for (const r of rows.results) {
        result.push(r.member, r.score);
      }
      return result as T[];
    }

    return rows.results.map((r: { member: string; score: number }) => r.member as unknown as T);
  },

  async zcount(key: string, min: number, max: number): Promise<number> {
    const db = getD1();
    await purgeIfExpired(db, key);
    const row = await db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM kv_zsets WHERE key = ? AND score >= ? AND score <= ?",
      )
      .bind(key, min, max)
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  },

  async zscore(key: string, member: string): Promise<number | null> {
    const db = getD1();
    await purgeIfExpired(db, key);
    const row = await db
      .prepare("SELECT score FROM kv_zsets WHERE key = ? AND member = ?")
      .bind(key, member)
      .first<{ score: number }>();
    return row?.score ?? null;
  },

  async zrem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    const db = getD1();
    await purgeIfExpired(db, key);
    const placeholders = members.map(() => "?").join(",");
    const result = await db
      .prepare(`DELETE FROM kv_zsets WHERE key = ? AND member IN (${placeholders})`)
      .bind(key, ...members)
      .run();
    return result.meta?.changes ?? 0;
  },

  async zcard(key: string): Promise<number> {
    const db = getD1();
    await purgeIfExpired(db, key);
    const row = await db
      .prepare("SELECT COUNT(*) AS cnt FROM kv_zsets WHERE key = ?")
      .bind(key)
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  },

  async zincrby(key: string, increment: number, member: string): Promise<number> {
    const db = getD1();
    await purgeIfExpired(db, key);
    const result = await db
      .prepare(
        `INSERT INTO kv_zsets (key, member, score) VALUES (?, ?, ?)
         ON CONFLICT(key, member) DO UPDATE SET score = score + ?
         RETURNING score`,
      )
      .bind(key, member, increment, increment)
      .first<{ score: number }>();
    return result?.score ?? increment;
  },

  async scan(
    cursor: number,
    options?: { match?: string; count?: number },
  ): Promise<[number, string[]]> {
    const db = getD1();
    const match = options?.match;
    const limit = options?.count ?? 1000;
    const now = nowMs();
    const offset = Number.isFinite(cursor) && cursor > 0
      ? Math.max(0, Math.floor(cursor))
      : 0;

    if (!match) {
      const totalRow = await db
        .prepare(
          "SELECT COUNT(*) AS cnt FROM kv_data WHERE expires_at IS NULL OR expires_at > ?",
        )
        .bind(now)
        .first<{ cnt: number }>();
      const rows = await db
        .prepare(
          `SELECT key FROM kv_data
           WHERE expires_at IS NULL OR expires_at > ?
           ORDER BY key
           LIMIT ? OFFSET ?`,
        )
        .bind(now, limit, offset)
        .all<{ key: string }>();
      const total = totalRow?.cnt ?? 0;
      const nextCursor = offset + rows.results.length < total
        ? offset + rows.results.length
        : 0;
      return [nextCursor, rows.results.map((r: { key: string }) => r.key)];
    }

    // Convert Redis glob pattern to SQL LIKE pattern
    const likePattern = match.replace(/\*/g, "%").replace(/\?/g, "_");
    const totalRow = await db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM kv_data
         WHERE (expires_at IS NULL OR expires_at > ?)
           AND key LIKE ?`,
      )
      .bind(now, likePattern)
      .first<{ cnt: number }>();
    const rows = await db
      .prepare(
        `SELECT key FROM kv_data
         WHERE (expires_at IS NULL OR expires_at > ?)
           AND key LIKE ?
         ORDER BY key
         LIMIT ? OFFSET ?`,
      )
      .bind(now, likePattern, limit, offset)
      .all<{ key: string }>();
    const total = totalRow?.cnt ?? 0;
    const nextCursor = offset + rows.results.length < total
      ? offset + rows.results.length
      : 0;
    return [nextCursor, rows.results.map((r: { key: string }) => r.key)];
  },

  // ==================== Hash commands ====================

  async hset(key: string, fields: Record<string, unknown>): Promise<number> {
    const entries = Object.entries(fields);
    if (entries.length === 0) return 0;
    const db = getD1();
    await purgeIfExpired(db, key);
    const stmts = entries.map(([field, value]) =>
      db
        .prepare(
          "INSERT OR REPLACE INTO kv_hashes (key, field, value) VALUES (?, ?, ?)",
        )
        .bind(key, field, serialize(value)),
    );
    await db.batch(stmts);
    return entries.length;
  },

  async hget<T = unknown>(key: string, field: string): Promise<T | null> {
    const db = getD1();
    await purgeIfExpired(db, key);
    const row = await db
      .prepare("SELECT value FROM kv_hashes WHERE key = ? AND field = ?")
      .bind(key, field)
      .first<{ value: string }>();
    if (!row) return null;
    return deserialize<T>(row.value);
  },

  async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
    const db = getD1();
    await purgeIfExpired(db, key);
    const rows = await db
      .prepare("SELECT field, value FROM kv_hashes WHERE key = ?")
      .bind(key)
      .all<{ field: string; value: string }>();
    if (rows.results.length === 0) return null;

    const obj: Record<string, unknown> = {};
    for (const row of rows.results) {
      obj[row.field] = deserialize(row.value);
    }
    return obj as T;
  },

  async hdel(key: string, ...fields: string[]): Promise<number> {
    if (fields.length === 0) return 0;
    const db = getD1();
    await purgeIfExpired(db, key);
    const placeholders = fields.map(() => "?").join(",");
    const result = await db
      .prepare(
        `DELETE FROM kv_hashes WHERE key = ? AND field IN (${placeholders})`,
      )
      .bind(key, ...fields)
      .run();
    return result.meta?.changes ?? 0;
  },

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const db = getD1();
    await purgeIfExpired(db, key);
    const result = await db
      .prepare(
        `INSERT INTO kv_hashes (key, field, value) VALUES (?, ?, ?)
         ON CONFLICT(key, field) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT)
         RETURNING CAST(value AS INTEGER) AS num`,
      )
      .bind(key, field, String(increment), increment)
      .first<{ num: number }>();
    return result?.num ?? increment;
  },

  async hmget<T = unknown>(key: string, ...fields: string[]): Promise<(T | null)[]> {
    if (fields.length === 0) return [];
    const db = getD1();
    await purgeIfExpired(db, key);
    const placeholders = fields.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT field, value FROM kv_hashes WHERE key = ? AND field IN (${placeholders})`,
      )
      .bind(key, ...fields)
      .all<{ field: string; value: string }>();

    const map = new Map<string, string>();
    for (const row of rows.results) {
      map.set(row.field, row.value);
    }

    return fields.map((f) => {
      const raw = map.get(f);
      if (raw === undefined) return null;
      return deserialize<T>(raw);
    });
  },

  // ==================== eval — NOT SUPPORTED ====================
  // All Lua script call sites are individually rewritten.

  async eval(): Promise<never> {
    throw new Error(
      "kv.eval() is not supported on D1. All Lua scripts must be individually rewritten.",
    );
  },
};
