import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';
import { getProfileOverview } from '../profile';
import { getUserCardData } from '../cards/draw';
import { getUserPoints, getPointsLogs } from '../points';
import { getCheckinStreak } from '../rankings';
import { listUserNotifications } from '../notifications';

vi.mock('@vercel/kv', () => ({
  kv: {
    lrange: vi.fn(),
  },
}));

vi.mock('../cards/draw', () => ({
  getUserCardData: vi.fn(),
}));

vi.mock('../points', () => ({
  getUserPoints: vi.fn(),
  getPointsLogs: vi.fn(),
}));

vi.mock('../rankings', () => ({
  getCheckinStreak: vi.fn(),
}));

vi.mock('../notifications', () => ({
  listUserNotifications: vi.fn(),
}));

describe('profile overview', () => {
  const mockKvLrange = vi.mocked(kv.lrange);
  const mockGetUserCardData = vi.mocked(getUserCardData);
  const mockGetUserPoints = vi.mocked(getUserPoints);
  const mockGetPointsLogs = vi.mocked(getPointsLogs);
  const mockGetCheckinStreak = vi.mocked(getCheckinStreak);
  const mockListUserNotifications = vi.mocked(listUserNotifications);

  beforeEach(() => {
    vi.clearAllMocks();

    mockKvLrange.mockResolvedValue([]);
    mockGetUserCardData.mockResolvedValue({
      inventory: ['animal-s1-common-仓鼠', 'animal-s1-rare-柴犬'],
      fragments: 30,
      pityCounter: 0,
      pityRare: 0,
      pityEpic: 0,
      pityLegendary: 0,
      pityLegendaryRare: 0,
      drawsAvailable: 2,
      collectionRewards: [],
    });
    mockGetUserPoints.mockResolvedValue(888);
    mockGetPointsLogs.mockResolvedValue([
      { id: 'l1', amount: 20, source: 'game_play', description: 'test', balance: 888, createdAt: 1000 },
      { id: 'l2', amount: -5, source: 'exchange', description: 'test2', balance: 883, createdAt: 900 },
    ]);
    mockGetCheckinStreak.mockResolvedValue(7);
    mockListUserNotifications.mockResolvedValue({
      unreadCount: 1,
      pagination: {
        page: 1,
        limit: 5,
        total: 1,
        totalPages: 1,
        hasMore: false,
      },
      items: [
        {
          id: 'n1',
          userId: 1001,
          type: 'system',
          title: 'hello',
          content: 'world',
          createdAt: 1100,
          isRead: false,
        },
      ],
    });
  });

  it('builds profile overview payload with merged recent records', async () => {
    mockKvLrange.mockImplementation(async (key: string) => {
      if (key === 'slot:records:1001') {
        return [{ score: 300, pointsEarned: 20, createdAt: 2000 }];
      }
      if (key === 'lottery:user:records:1001') {
        return [{ tierValue: 5, createdAt: 2100 }];
      }
      return [];
    });

    const overview = await getProfileOverview({
      id: 1001,
      username: 'alice',
    });

    expect(overview.user).toMatchObject({ id: 1001, username: 'alice' });
    expect(overview.points.balance).toBe(888);
    expect(overview.cards.owned).toBe(2);
    expect(overview.gameplay.checkinStreak).toBe(7);
    expect(overview.notifications.unreadCount).toBe(1);
    expect(overview.gameplay.recentRecords[0]).toMatchObject({
      gameType: 'lottery',
      score: 5,
      createdAt: 2100,
    });
    expect(overview.gameplay.recentRecords[1]).toMatchObject({
      gameType: 'slot',
      score: 300,
      pointsEarned: 20,
      createdAt: 2000,
    });
  });
});
