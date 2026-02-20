// src/lib/d1-kv.ts — Cloudflare D1 adapter with @vercel/kv-compatible API
// Replaces @vercel/kv (Upstash Redis) with D1 (SQLite)

import { getCloudflareContext } from "@opennextjs/cloudflare";

let _db: D1Database | null = null;

function getD1(): D1Database {
  if (_db) return _db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (getCloudflareContext as any)?.();
  const env = ctx?.env as CloudflareEnv | undefined;
  if (!env?.KV_DB) {
    throw new Error("D1 binding KV_DB not available");
  }
  _db = env.KV_DB;
  return _db;
}

/** Reset cached binding (for testing). */
export function __resetD1(): void {
  _db = null;
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

// ---------- kv object ----------

export const kv = {
  // ==================== String commands ====================

  async get<T = unknown>(key: string): Promise<T | null> {
    const db = getD1();
    const row = await db
      .prepare("SELECT value, expires_at FROM kv_data WHERE key = ?")
      .bind(key)
      .first<{ value: string; expires_at: number | null }>();
    if (!row) return null;
    if (isExpired(row.expires_at)) {
      await db.prepare("DELETE FROM kv_data WHERE key = ?").bind(key).run();
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
      // Only set if not exists (or expired)
      const existing = await db
        .prepare("SELECT expires_at FROM kv_data WHERE key = ?")
        .bind(key)
        .first<{ expires_at: number | null }>();
      if (existing && !isExpired(existing.expires_at)) {
        return null;
      }
      // Delete if expired then insert
      await db
        .prepare(
          "INSERT OR REPLACE INTO kv_data (key, value, expires_at) VALUES (?, ?, ?)",
        )
        .bind(key, serialized, expiresAt)
        .run();
      return "OK";
    }

    await db
      .prepare(
        "INSERT OR REPLACE INTO kv_data (key, value, expires_at) VALUES (?, ?, ?)",
      )
      .bind(key, serialized, expiresAt)
      .run();
    return "OK";
  },

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const db = getD1();
    const placeholders = keys.map(() => "?").join(",");
    const stmts = [
      db.prepare(`DELETE FROM kv_data WHERE key IN (${placeholders})`).bind(...keys),
      db.prepare(`DELETE FROM kv_lists WHERE key IN (${placeholders})`).bind(...keys),
      db.prepare(`DELETE FROM kv_sets WHERE key IN (${placeholders})`).bind(...keys),
      db.prepare(`DELETE FROM kv_zsets WHERE key IN (${placeholders})`).bind(...keys),
      db.prepare(`DELETE FROM kv_hashes WHERE key IN (${placeholders})`).bind(...keys),
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
    const placeholders = keys.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT key, value, expires_at FROM kv_data WHERE key IN (${placeholders})`,
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
      const ep = expiredKeys.map(() => "?").join(",");
      await db.prepare(`DELETE FROM kv_data WHERE key IN (${ep})`).bind(...expiredKeys).run();
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
    if (!row) return -2; // key does not exist
    if (row.expires_at === null) return -1; // no expiry
    const remaining = Math.ceil((row.expires_at - nowMs()) / 1000);
    if (remaining <= 0) {
      await db.prepare("DELETE FROM kv_data WHERE key = ?").bind(key).run();
      return -2;
    }
    return remaining;
  },

  async expire(key: string, seconds: number): Promise<number> {
    const db = getD1();
    const expiresAt = nowMs() + seconds * 1000;
    const result = await db
      .prepare("UPDATE kv_data SET expires_at = ? WHERE key = ?")
      .bind(expiresAt, key)
      .run();
    return (result.meta?.changes ?? 0) > 0 ? 1 : 0;
  },

  async exists(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const db = getD1();
    const now = nowMs();
    const placeholders = keys.map(() => "?").join(",");
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM kv_data WHERE key IN (${placeholders}) AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .bind(...keys, now)
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  },

  // ==================== List commands ====================

  async lpush(key: string, ...values: unknown[]): Promise<number> {
    if (values.length === 0) return 0;
    const db = getD1();
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
    // Get total count for negative index support
    const countRow = await db
      .prepare("SELECT COUNT(*) AS cnt FROM kv_lists WHERE key = ?")
      .bind(key)
      .first<{ cnt: number }>();
    const total = countRow?.cnt ?? 0;
    if (total === 0) return [];

    // Normalize negative indices
    let s = start < 0 ? Math.max(0, total + start) : start;
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

    return rows.results.map((r) => deserialize<T>(r.value)!);
  },

  async llen(key: string): Promise<number> {
    const db = getD1();
    const row = await db
      .prepare("SELECT COUNT(*) AS cnt FROM kv_lists WHERE key = ?")
      .bind(key)
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  },

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    const db = getD1();
    // Get all ids ordered by id DESC (LPUSH head first)
    const rows = await db
      .prepare("SELECT id FROM kv_lists WHERE key = ? ORDER BY id DESC")
      .bind(key)
      .all<{ id: number }>();
    const total = rows.results.length;
    if (total === 0) return;

    let s = start < 0 ? Math.max(0, total + start) : start;
    let e = stop < 0 ? total + stop : stop;
    if (e >= total) e = total - 1;

    if (s > e) {
      // Trim everything
      await db.prepare("DELETE FROM kv_lists WHERE key = ?").bind(key).run();
      return;
    }

    const keepIds = new Set(rows.results.slice(s, e + 1).map((r) => r.id));
    const deleteIds = rows.results.filter((r) => !keepIds.has(r.id)).map((r) => r.id);

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

    const ids = rows.results.map((r) => r.id);
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
    const placeholders = members.map(() => "?").join(",");
    const result = await db
      .prepare(`DELETE FROM kv_sets WHERE key = ? AND member IN (${placeholders})`)
      .bind(key, ...members.map(String))
      .run();
    return result.meta?.changes ?? 0;
  },

  async scard(key: string): Promise<number> {
    const db = getD1();
    const row = await db
      .prepare("SELECT COUNT(*) AS cnt FROM kv_sets WHERE key = ?")
      .bind(key)
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  },

  async smembers<T = string>(key: string): Promise<T[]> {
    const db = getD1();
    const rows = await db
      .prepare("SELECT member FROM kv_sets WHERE key = ?")
      .bind(key)
      .all<{ member: string }>();
    return rows.results.map((r) => r.member as unknown as T);
  },

  async sismember(key: string, member: unknown): Promise<number> {
    const db = getD1();
    const row = await db
      .prepare("SELECT 1 AS ok FROM kv_sets WHERE key = ? AND member = ?")
      .bind(key, String(member))
      .first<{ ok: number }>();
    return row ? 1 : 0;
  },

  // ==================== Sorted Set commands ====================

  async zadd(
    key: string,
    ...items: Array<{ score: number; member: string }>
  ): Promise<number> {
    if (items.length === 0) return 0;
    const db = getD1();
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
    start: number,
    stop: number,
    options?: { rev?: boolean },
  ): Promise<T[]> {
    const db = getD1();
    const countRow = await db
      .prepare("SELECT COUNT(*) AS cnt FROM kv_zsets WHERE key = ?")
      .bind(key)
      .first<{ cnt: number }>();
    const total = countRow?.cnt ?? 0;
    if (total === 0) return [];

    let s = start < 0 ? Math.max(0, total + start) : start;
    let e = stop < 0 ? total + stop : stop;
    if (e >= total) e = total - 1;
    if (s > e) return [];

    const limit = e - s + 1;
    const order = options?.rev ? "DESC" : "ASC";

    const rows = await db
      .prepare(
        `SELECT member FROM kv_zsets WHERE key = ? ORDER BY score ${order}, member ${order} LIMIT ? OFFSET ?`,
      )
      .bind(key, limit, s)
      .all<{ member: string }>();

    return rows.results.map((r) => r.member as unknown as T);
  },

  async zcount(key: string, min: number, max: number): Promise<number> {
    const db = getD1();
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
    const row = await db
      .prepare("SELECT score FROM kv_zsets WHERE key = ? AND member = ?")
      .bind(key, member)
      .first<{ score: number }>();
    return row?.score ?? null;
  },

  // ==================== Hash commands ====================

  async hset(key: string, fields: Record<string, unknown>): Promise<number> {
    const entries = Object.entries(fields);
    if (entries.length === 0) return 0;
    const db = getD1();
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
    const row = await db
      .prepare("SELECT value FROM kv_hashes WHERE key = ? AND field = ?")
      .bind(key, field)
      .first<{ value: string }>();
    if (!row) return null;
    return deserialize<T>(row.value);
  },

  async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
    const db = getD1();
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
