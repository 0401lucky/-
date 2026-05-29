import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { acquireNativeLock, hasNativeHotStoreBinding, releaseNativeLock } from '../hot-d1';
import { acquireGameLock, releaseGameLock } from '../game-locks';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('../hot-d1', () => ({
  acquireNativeLock: vi.fn(async () => true),
  hasNativeHotStoreBinding: vi.fn(() => false),
  releaseNativeLock: vi.fn(),
}));

describe('game-locks', () => {
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvDel = vi.mocked(kv.del);
  const mockAcquireNativeLock = vi.mocked(acquireNativeLock);
  const mockHasNativeHotStoreBinding = vi.mocked(hasNativeHotStoreBinding);
  const mockReleaseNativeLock = vi.mocked(releaseNativeLock);

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvSet.mockResolvedValue('OK');
    mockKvGet.mockResolvedValue(null);
    mockAcquireNativeLock.mockResolvedValue(true);
    mockHasNativeHotStoreBinding.mockReturnValue(false);
  });

  it('有 D1 binding 时优先使用原生锁', async () => {
    mockHasNativeHotStoreBinding.mockReturnValue(true);

    const token = await acquireGameLock('game:lock:1', 3, false);

    expect(token).toEqual(expect.any(String));
    expect(mockAcquireNativeLock).toHaveBeenCalledWith('game:lock:1', token, 3);
    expect(mockKvSet).not.toHaveBeenCalled();

    await releaseGameLock('game:lock:1', token!, false);

    expect(mockReleaseNativeLock).toHaveBeenCalledWith('game:lock:1', token);
    expect(mockKvGet).not.toHaveBeenCalled();
    expect(mockKvDel).not.toHaveBeenCalled();
  });

  it('没有 D1 binding 时保留 KV 兼容锁', async () => {
    const token = await acquireGameLock('game:lock:2', 3, false);
    mockKvGet.mockResolvedValue(token);

    expect(token).toEqual(expect.any(String));
    expect(mockKvSet).toHaveBeenCalledWith('game:lock:2', token, { ex: 3, nx: true });

    await releaseGameLock('game:lock:2', token!, false);

    expect(mockKvDel).toHaveBeenCalledWith('game:lock:2');
    expect(mockAcquireNativeLock).not.toHaveBeenCalled();
    expect(mockReleaseNativeLock).not.toHaveBeenCalled();
  });
});
