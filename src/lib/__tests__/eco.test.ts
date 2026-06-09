import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { buyEcoItem, getEcoTrashLeaderboard } from '../eco';
import { createInitialEcoState, getStorageCap } from '../eco-engine';
import { getAllUsers } from '../kv';
import { getCustomUserProfile } from '../user-profile';
import { getEquippedAchievementForUser } from '../user-achievements';
import { acquireGameLock, releaseGameLock } from '../game-locks';
import { isNativeHotStoreReady } from '../hot-d1';
import { addPoints, deductPoints, getUserPoints } from '../points';
import type { EcoState } from '../types/eco';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    hgetall: vi.fn(),
    zrange: vi.fn(),
    zcard: vi.fn(),
  },
}));

vi.mock('../kv', () => ({
  getAllUsers: vi.fn(),
}));

vi.mock('../user-profile', () => ({
  getCustomUserProfile: vi.fn(),
}));

vi.mock('../user-achievements', () => ({
  getEquippedAchievementForUser: vi.fn(),
}));

vi.mock('../points', () => ({
  addPoints: vi.fn(),
  deductPoints: vi.fn(),
  getUserPoints: vi.fn(),
}));

vi.mock('../game-locks', () => ({
  acquireGameLock: vi.fn(),
  releaseGameLock: vi.fn(),
}));

vi.mock('../hot-d1', () => ({
  isNativeHotStoreReady: vi.fn(),
}));

describe('eco service', () => {
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvHgetall = vi.mocked(kv.hgetall);
  const mockKvZrange = vi.mocked(kv.zrange);
  const mockKvZcard = vi.mocked(kv.zcard);
  const mockGetAllUsers = vi.mocked(getAllUsers);
  const mockGetCustomUserProfile = vi.mocked(getCustomUserProfile);
  const mockGetEquippedAchievementForUser = vi.mocked(getEquippedAchievementForUser);
  const mockAcquireGameLock = vi.mocked(acquireGameLock);
  const mockReleaseGameLock = vi.mocked(releaseGameLock);
  const mockIsNativeHotStoreReady = vi.mocked(isNativeHotStoreReady);
  const mockAddPoints = vi.mocked(addPoints);
  const mockDeductPoints = vi.mocked(deductPoints);
  const mockGetUserPoints = vi.mocked(getUserPoints);

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockKvSet.mockResolvedValue('OK');
    mockKvHgetall.mockResolvedValue({});
    mockKvZcard.mockResolvedValue(3);
    mockGetAllUsers.mockResolvedValue([
      { id: 1001, username: 'alice', firstSeen: 1 },
      { id: 1002, username: 'bob', firstSeen: 1 },
      { id: 1003, username: 'cindy', firstSeen: 1 },
    ]);
    mockGetCustomUserProfile.mockResolvedValue({});
    mockGetEquippedAchievementForUser.mockResolvedValue(null);
    mockAcquireGameLock.mockResolvedValue('token');
    mockReleaseGameLock.mockResolvedValue(undefined);
    mockIsNativeHotStoreReady.mockResolvedValue(false);
    mockAddPoints.mockResolvedValue({ success: true, balance: 1000 });
    mockDeductPoints.mockResolvedValue({ success: true, balance: 965 });
    mockGetUserPoints.mockResolvedValue(965);
  });

  it('builds eco trash leaderboard and resolves ties by user id', async () => {
    mockKvZrange.mockResolvedValue(['u:1002', 7, 'u:1001', 7, 'u:1003', 3]);
    mockGetCustomUserProfile.mockImplementation(async (userId: number) => (
      userId === 1001 ? { displayName: 'Alice Eco', avatarUrl: 'avatar.png' } : {}
    ));

    const result = await getEcoTrashLeaderboard('daily', 10);

    expect(mockKvZrange).toHaveBeenCalledWith(
      expect.any(String),
      0,
      -1,
      { rev: true, withScores: true },
    );
    expect(result.totalParticipants).toBe(3);
    expect(result.leaderboard.map((entry) => entry.userId)).toEqual([1001, 1002, 1003]);
    expect(result.leaderboard[0]).toMatchObject({
      rank: 1,
      username: 'alice',
      displayName: 'Alice Eco',
      avatarUrl: 'avatar.png',
      trashCleared: 7,
    });
  });

  it('keeps clear truck trash within storage capacity including visible prize slots', async () => {
    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    const cap = getStorageCap(state);
    state.points = 1000;
    state.pending = cap - 1;
    state.visiblePrizes = [
      { id: 'coin-prize', key: 'coin', createdAt: now },
      { id: 'photo-prize', key: 'photo', createdAt: now },
    ];
    mockKvGet.mockResolvedValue(state);

    const result = await buyEcoItem(1001, 'clear_truck');

    expect(result.ok).toBe(true);
    const saved = mockKvSet.mock.calls.find(([key]) => key === 'eco:state:1001')?.[1] as EcoState;
    expect(saved.pending).toBe(cap - saved.visiblePrizes.length);
    expect(saved.pending + saved.visiblePrizes.length).toBeLessThanOrEqual(cap);
  });

  it('refunds item cost when eco state save fails after points deduction', async () => {
    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    state.points = 1000;
    mockKvGet.mockResolvedValue(state);
    mockKvSet.mockRejectedValueOnce(new Error('KV_WRITE_FAILED'));

    await expect(buyEcoItem(1001, 'recycle_glove')).rejects.toThrow('KV_WRITE_FAILED');

    expect(mockDeductPoints).toHaveBeenCalledWith(
      1001,
      25,
      'exchange',
      '环保行动道具·回收手套',
    );
    expect(mockAddPoints).toHaveBeenCalledWith(
      1001,
      25,
      'exchange_refund',
      '环保行动道具·回收手套回滚',
    );
  });
});
