import { randomUUID } from "crypto";
import { kv } from "@/lib/d1-kv";

const DEFAULT_LOCK_TTL_SECONDS = 12;
const DEFAULT_LOCK_MAX_RETRIES = 20;
const DEFAULT_LOCK_RETRY_MS = 30;

interface KvLockOptions {
  ttlSeconds?: number;
  maxRetries?: number;
  retryMs?: number;
  timeoutMessage?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getUserEconomyLockKey(userId: number | string): string {
  return `lock:user:economy:${userId}`;
}

export async function withKvLock<T>(
  lockKey: string,
  handler: () => Promise<T>,
  options: KvLockOptions = {}
): Promise<T> {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_LOCK_TTL_SECONDS;
  const maxRetries = options.maxRetries ?? DEFAULT_LOCK_MAX_RETRIES;
  const retryMs = options.retryMs ?? DEFAULT_LOCK_RETRY_MS;
  const token = `${Date.now()}_${randomUUID()}`;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const acquired = await kv.set(lockKey, token, {
      nx: true,
      ex: ttlSeconds,
    });

    if (acquired === "OK") {
      try {
        return await handler();
      } finally {
        try {
          const current = await kv.get<string>(lockKey);
          if (current === token) {
            await kv.del(lockKey);
          }
        } catch (error) {
          console.error("释放分布式锁失败:", { lockKey, error });
        }
      }
    }

    await sleep(retryMs);
  }

  throw new Error(options.timeoutMessage ?? `LOCK_TIMEOUT:${lockKey}`);
}

export async function withUserEconomyLock<T>(
  userId: number | string,
  handler: () => Promise<T>,
  options: KvLockOptions = {}
): Promise<T> {
  return withKvLock(getUserEconomyLockKey(userId), handler, options);
}
