import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { getEcoTrashLeaderboard } from '../eco';
import { getAllUsers } from '../kv';
import { getCustomUserProfile } from '../user-profile';
import { getEquippedAchievementForUser } from '../user-achievements';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
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
  const mockKvZrange = vi.mocked(kv.zrange);
  const mockKvZcard = vi.mocked(kv.zcard);
  const mockGetAllUsers = vi.mocked(getAllUsers);
  const mockGetCustomUserProfile = vi.mocked(getCustomUserProfile);
  const mockGetEquippedAchievementForUser = vi.mocked(getEquippedAchievementForUser);

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvZcard.mockResolvedValue(3);
    mockGetAllUsers.mockResolvedValue([
      { id: 1001, username: 'alice', firstSeen: 1 },
      { id: 1002, username: 'bob', firstSeen: 1 },
      { id: 1003, username: 'cindy', firstSeen: 1 },
    ]);
    mockGetCustomUserProfile.mockResolvedValue({});
    mockGetEquippedAchievementForUser.mockResolvedValue(null);
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
});
