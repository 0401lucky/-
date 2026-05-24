import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import {
  getAllGamesLeaderboard,
  getCheckinStreak,
  getCheckinStreakLeaderboard,
  getGameLeaderboard,
  getMonthlyPeakHistory,
  getPointsLeaderboard,
} from '../rankings';
import { getAllUsers } from '../kv';
import {
  getNativeGameLeaderboardRows,
  getNativeOverallBreakdownRows,
  getNativeRankingCache,
  isNativeHotStoreReady,
  setNativeRankingCache,
} from '../hot-d1';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    lrange: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    mget: vi.fn(),
  },
}));

vi.mock('../kv', () => ({
  getAllUsers: vi.fn(),
}));

vi.mock('../hot-d1', () => ({
  getNativeCheckinEntries: vi.fn(),
  getNativeGameLeaderboardRows: vi.fn(),
  getNativeOverallBreakdownRows: vi.fn(),
  getNativePointsLeaderboardRows: vi.fn(),
  getNativePositivePointsLeaderboardRowsByRange: vi.fn(),
  getNativeRankingCache: vi.fn(),
  isNativeHotStoreReady: vi.fn(),
  listNativeCheckinDates: vi.fn(),
  setNativeRankingCache: vi.fn(),
}));

vi.mock('../user-profile', () => ({
  getCustomUserProfile: vi.fn().mockResolvedValue({}),
}));

vi.mock('../user-achievements', () => ({
  getEquippedAchievementForUser: vi.fn().mockResolvedValue(null),
}));

describe('rankings', () => {
  const mockKvLrange = vi.mocked(kv.lrange);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvMget = vi.mocked(kv.mget);
  const mockGetAllUsers = vi.mocked(getAllUsers);
  const mockIsNativeHotStoreReady = vi.mocked(isNativeHotStoreReady);
  const mockGetNativeGameLeaderboardRows = vi.mocked(getNativeGameLeaderboardRows);
  const mockGetNativeOverallBreakdownRows = vi.mocked(getNativeOverallBreakdownRows);
  const mockGetNativeRankingCache = vi.mocked(getNativeRankingCache);
  const mockSetNativeRankingCache = vi.mocked(setNativeRankingCache);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllUsers.mockResolvedValue([
      { id: 1001, username: 'alice', firstSeen: 1 },
      { id: 1002, username: 'bob', firstSeen: 1 },
    ]);
    mockKvLrange.mockResolvedValue([]);
    mockKvGet.mockResolvedValue(0);
    mockKvSet.mockResolvedValue('OK');
    mockKvMget.mockResolvedValue([]);
    mockIsNativeHotStoreReady.mockResolvedValue(false);
    mockGetNativeGameLeaderboardRows.mockResolvedValue([]);
    mockGetNativeOverallBreakdownRows.mockResolvedValue([]);
    mockGetNativeRankingCache.mockResolvedValue(null);
    mockSetNativeRankingCache.mockResolvedValue(undefined);
  });

  it('builds game leaderboard and sorts by best single score', async () => {
    const now = Date.now();

    mockKvLrange.mockImplementation(async (key: string) => {
      if (key === 'linkgame:records:1001') {
        return [
          { score: 120, pointsEarned: 30, createdAt: now - 1000 },
          { score: 80, pointsEarned: 20, createdAt: now - 2000 },
        ];
      }
      if (key === 'linkgame:records:1002') {
        return [{ score: 150, pointsEarned: 35, createdAt: now - 1000 }];
      }
      return [];
    });

    const leaderboard = await getGameLeaderboard('linkgame', 'daily', 10);

    expect(leaderboard).toHaveLength(2);
    expect(leaderboard[0]).toMatchObject({
      rank: 1,
      userId: 1002,
      totalScore: 150,
      bestScore: 150,
    });
    expect(leaderboard[1]).toMatchObject({
      rank: 2,
      userId: 1001,
      totalScore: 200,
      totalPoints: 50,
      bestScore: 120,
      gamesPlayed: 2,
    });
  });

  it('filters multi-difficulty game leaderboards by difficulty', async () => {
    const now = Date.now();

    mockKvLrange.mockImplementation(async (key: string) => {
      if (key === 'minesweeper:records:1001') {
        return [
          { score: 300, pointsEarned: 30, difficulty: 'easy', createdAt: now - 1000 },
          { score: 100, pointsEarned: 10, difficulty: 'normal', createdAt: now - 2000 },
        ];
      }
      if (key === 'minesweeper:records:1002') {
        return [{ score: 220, pointsEarned: 25, difficulty: 'normal', createdAt: now - 1000 }];
      }
      return [];
    });

    const normal = await getGameLeaderboard('minesweeper', 'daily', 10, 'normal');
    expect(normal).toHaveLength(2);
    expect(normal[0]).toMatchObject({
      rank: 1,
      userId: 1002,
      bestScore: 220,
    });
    expect(normal[1]).toMatchObject({
      rank: 2,
      userId: 1001,
      bestScore: 100,
    });

    const easy = await getGameLeaderboard('minesweeper', 'daily', 10, 'easy');
    expect(easy).toHaveLength(1);
    expect(easy[0]).toMatchObject({
      rank: 1,
      userId: 1001,
      bestScore: 300,
    });
  });

  it('builds all-games overall leaderboard', async () => {
    const now = Date.now();

    mockKvGet.mockResolvedValueOnce(null);
    mockKvLrange.mockImplementation(async (key: string) => {
      if (key.endsWith(':1001')) {
        return [{ score: 100, pointsEarned: 20, createdAt: now - 1000 }];
      }
      if (key.endsWith(':1002')) {
        return [{ score: 80, pointsEarned: 10, createdAt: now - 1000 }];
      }
      return [];
    });

    const result = await getAllGamesLeaderboard('daily', {
      limitPerGame: 10,
      overallLimit: 10,
    });

    const gameTypes = result.games.map((item) => item.gameType).sort();

    expect(result.games).toHaveLength(6);
    expect(gameTypes).toEqual(['linkgame', 'match3', 'memory', 'minesweeper', 'roguelite', 'whack_mole']);
    expect(result.overall[0]).toMatchObject({
      userId: 1001,
    });
    expect(result.overall[1]).toMatchObject({
      userId: 1002,
    });
    expect(mockKvSet).toHaveBeenCalledTimes(1);
  });

  it('returns cached all-games leaderboard when available', async () => {
    const cached = {
      period: 'daily' as const,
      generatedAt: 123,
      startAt: 456,
      games: [{ gameType: 'linkgame' as const, leaderboard: [] }],
      overall: [],
    };
    mockKvGet.mockResolvedValueOnce(cached as any);

    const result = await getAllGamesLeaderboard('daily', {
      limitPerGame: 10,
      overallLimit: 10,
    });

    expect(result).toEqual(cached);
    expect(mockKvLrange).not.toHaveBeenCalled();
    expect(mockKvSet).not.toHaveBeenCalled();
  });

  it('uses a finite end time for open-ended native game ranking queries', async () => {
    mockIsNativeHotStoreReady.mockResolvedValue(true);

    await getAllGamesLeaderboard('daily', {
      limitPerGame: 10,
      overallLimit: 10,
    });

    expect(mockGetNativeGameLeaderboardRows).toHaveBeenCalledTimes(18);
    for (const call of mockGetNativeGameLeaderboardRows.mock.calls) {
      expect(Number.isFinite(call[2])).toBe(true);
      expect(call[2]).toBe(8_640_000_000_000_000);
    }
    expect(mockGetNativeOverallBreakdownRows).toHaveBeenCalledWith(
      expect.any(Number),
      8_640_000_000_000_000,
    );
  });

  it('builds points leaderboard for all and monthly period', async () => {
    mockKvGet
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(500);

    const all = await getPointsLeaderboard('all', 10);
    expect(all.leaderboard[0]).toMatchObject({ userId: 1001, points: 1000 });

    mockKvLrange.mockImplementation(async (key: string) => {
      if (key === 'points_log:1001') {
        return [
          { amount: 200, createdAt: Date.now() },
          { amount: -50, createdAt: Date.now() },
        ];
      }
      if (key === 'points_log:1002') {
        return [{ amount: 80, createdAt: Date.now() }];
      }
      return [];
    });

    const monthly = await getPointsLeaderboard('monthly', 10);
    expect(monthly.leaderboard[0]).toMatchObject({ userId: 1001, points: 200 });
    expect(monthly.leaderboard[1]).toMatchObject({ userId: 1002, points: 80 });
  });

  it('builds monthly peak history from positive point income only', async () => {
    const referenceTime = new Date('2026-05-21T04:00:00.000Z').getTime();
    const aprilTs = new Date('2026-04-10T04:00:00.000Z').getTime();
    const marchTs = new Date('2026-03-10T04:00:00.000Z').getTime();

    mockKvLrange.mockImplementation(async (key: string) => {
      if (key === 'points_log:1001') {
        return [
          { amount: 300, createdAt: aprilTs },
          { amount: -70, createdAt: aprilTs },
          { amount: 50, createdAt: marchTs },
        ];
      }
      if (key === 'points_log:1002') {
        return [{ amount: 120, createdAt: aprilTs }];
      }
      return [];
    });

    const history = await getMonthlyPeakHistory({
      months: 1,
      topLimit: 10,
      referenceTime,
    });

    expect(history.months[0].monthKey).toBe('2026-04');
    expect(history.months[0].leaderboard[0]).toMatchObject({
      rank: 1,
      userId: 1001,
      points: 300,
    });
    expect(history.months[0].leaderboard[1]).toMatchObject({
      rank: 2,
      userId: 1002,
      points: 120,
    });
  });

  it('calculates checkin streak and leaderboard', async () => {
    (mockKvMget as any).mockImplementation(async (...keys: any[]) => {
      const firstKey = (Array.isArray(keys[0]) ? keys[0][0] : keys[0]) ?? '';
      if (firstKey.includes('user:checkin:1001:')) {
        return [true, true, true, null];
      }
      if (firstKey.includes('user:checkin:1002:')) {
        return [true, null];
      }
      return [];
    });

    const streak = await getCheckinStreak(1001, 'all');
    expect(streak).toBe(3);

    const leaderboard = await getCheckinStreakLeaderboard('all', 10);
    expect(leaderboard.leaderboard[0]).toMatchObject({ userId: 1001, streak: 3 });
    expect(leaderboard.leaderboard[1]).toMatchObject({ userId: 1002, streak: 1 });
  });

  it('counts streak from yesterday when today not checked in', async () => {
    (mockKvMget as any).mockImplementation(async (...keys: any[]) => {
      const firstKey = (Array.isArray(keys[0]) ? keys[0][0] : keys[0]) ?? '';
      if (firstKey.includes('user:checkin:1001:')) {
        return [null, true, true, null];
      }
      if (firstKey.includes('user:checkin:1002:')) {
        return [null, true, null];
      }
      return [];
    });

    const streak = await getCheckinStreak(1001, 'all');
    expect(streak).toBe(2);

    const leaderboard = await getCheckinStreakLeaderboard('all', 10);
    expect(leaderboard.leaderboard[0]).toMatchObject({ userId: 1001, streak: 2 });
    expect(leaderboard.leaderboard[1]).toMatchObject({ userId: 1002, streak: 1 });
  });
});

