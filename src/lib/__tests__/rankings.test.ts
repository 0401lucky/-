import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';
import {
  getAllGamesLeaderboard,
  getCheckinStreak,
  getCheckinStreakLeaderboard,
  getGameLeaderboard,
  getPointsLeaderboard,
} from '../rankings';
import { getAllUsers } from '../kv';

vi.mock('@vercel/kv', () => ({
  kv: {
    lrange: vi.fn(),
    get: vi.fn(),
    mget: vi.fn(),
  },
}));

vi.mock('../kv', () => ({
  getAllUsers: vi.fn(),
}));

describe('rankings', () => {
  const mockKvLrange = vi.mocked(kv.lrange);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvMget = vi.mocked(kv.mget);
  const mockGetAllUsers = vi.mocked(getAllUsers);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllUsers.mockResolvedValue([
      { id: 1001, username: 'alice', firstSeen: 1 },
      { id: 1002, username: 'bob', firstSeen: 1 },
    ]);
    mockKvLrange.mockResolvedValue([]);
    mockKvGet.mockResolvedValue(0);
    mockKvMget.mockResolvedValue([]);
  });

  it('builds game leaderboard and sorts by total score', async () => {
    const now = Date.now();

    mockKvLrange.mockImplementation(async (key: string) => {
      if (key === 'slot:records:1001') {
        return [
          { score: 120, pointsEarned: 30, createdAt: now - 1000 },
          { score: 80, pointsEarned: 20, createdAt: now - 2000 },
        ];
      }
      if (key === 'slot:records:1002') {
        return [{ score: 150, pointsEarned: 35, createdAt: now - 1000 }];
      }
      return [];
    });

    const leaderboard = await getGameLeaderboard('slot', 'daily', 10);

    expect(leaderboard).toHaveLength(2);
    expect(leaderboard[0]).toMatchObject({
      rank: 1,
      userId: 1001,
      totalScore: 200,
      totalPoints: 50,
      gamesPlayed: 2,
    });
    expect(leaderboard[1]).toMatchObject({
      rank: 2,
      userId: 1002,
      totalScore: 150,
    });
  });

  it('builds all-games overall leaderboard', async () => {
    const now = Date.now();

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
    expect(gameTypes).toEqual(['linkgame', 'match3', 'memory', 'pachinko', 'slot', 'tower']);
    expect(result.overall[0]).toMatchObject({
      userId: 1001,
    });
    expect(result.overall[1]).toMatchObject({
      userId: 1002,
    });
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
    expect(monthly.leaderboard[0]).toMatchObject({ userId: 1001, points: 150 });
    expect(monthly.leaderboard[1]).toMatchObject({ userId: 1002, points: 80 });
  });

  it('calculates checkin streak and leaderboard', async () => {
    mockKvMget.mockImplementation(async (...keys: string[]) => {
      const firstKey = keys[0] ?? '';
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
    mockKvMget.mockImplementation(async (...keys: string[]) => {
      const firstKey = keys[0] ?? '';
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

