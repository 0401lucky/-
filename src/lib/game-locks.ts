import { randomBytes } from 'crypto';
import { kv } from '@/lib/d1-kv';
import { acquireNativeLock, releaseNativeLock } from './hot-d1';

export function createGameLockToken(): string {
  return randomBytes(16).toString('hex');
}

export async function acquireGameLock(
  lockKey: string,
  ttlSeconds: number,
  useNativeHotStore: boolean,
): Promise<string | null> {
  const token = createGameLockToken();
  const acquired = useNativeHotStore
    ? await acquireNativeLock(lockKey, token, ttlSeconds)
    : await kv.set(lockKey, token, { ex: ttlSeconds, nx: true });

  return acquired === true || acquired === 'OK' ? token : null;
}

export async function releaseGameLock(
  lockKey: string,
  token: string,
  useNativeHotStore: boolean,
): Promise<void> {
  if (useNativeHotStore) {
    await releaseNativeLock(lockKey, token);
    return;
  }

  const currentToken = await kv.get<string>(lockKey);
  if (currentToken === token) {
    await kv.del(lockKey);
  }
}
