import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { getProfileOverview } from '../profile';
import { getUserCardData } from '../cards/draw';
import { getUserPoints, getPointsLogs } from '../points';
import { getCheckinStreak, getTotalCheckinDays } from '../rankings';
import { listUserNotifications } from '../notifications';
import { getLinkGameRecords } from '../linkgame-server';
import { getMatch3Records } from '../match3';
import { getMemoryRecords } from '../memory';
import { getMinesweeperRecords } from '../minesweeper';
import { getRogueliteRecords } from '../roguelite';
import { getWhackMoleRecords } from '../whack-mole';
import { getUserLotteryRecords } from '../lottery';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    lrange: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
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
  getTotalCheckinDays: vi.fn(),
}));

vi.mock('../notifications', () => ({
  listUserNotifications: vi.fn(),
}));

vi.mock('../linkgame-server', () => ({
  getLinkGameRecords: vi.fn(),
}));

vi.mock('../match3', () => ({
  getMatch3Records: vi.fn(),
}));

vi.mock('../match3-engine', () => ({
  MATCH3_WIN_SCORE: 1000,
}));

vi.mock('../memory', () => ({
  getMemoryRecords: vi.fn(),
}));

vi.mock('../minesweeper', () => ({
  getMinesweeperRecords: vi.fn(),
}));

vi.mock('../roguelite', () => ({
  getRogueliteRecords: vi.fn(),
}));

vi.mock('../whack-mole', () => ({
  getWhackMoleRecords: vi.fn(),
}));

vi.mock('../whack-mole-engine', () => ({
  WHACK_MOLE_WIN_SCORE: 300,
}));

vi.mock('../lottery', () => ({
  getUserLotteryRecords: vi.fn(),
}));

describe('profile overview', () => {
  const mockKvLrange = vi.mocked(kv.lrange);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvDel = vi.mocked(kv.del);
  const mockGetUserCardData = vi.mocked(getUserCardData);
  const mockGetUserPoints = vi.mocked(getUserPoints);
  const mockGetPointsLogs = vi.mocked(getPointsLogs);
  const mockGetCheckinStreak = vi.mocked(getCheckinStreak);
  const mockGetTotalCheckinDays = vi.mocked(getTotalCheckinDays);
  const mockListUserNotifications = vi.mocked(listUserNotifications);
  const mockGetLinkGameRecords = vi.mocked(getLinkGameRecords);
  const mockGetMatch3Records = vi.mocked(getMatch3Records);
  const mockGetMemoryRecords = vi.mocked(getMemoryRecords);
  const mockGetMinesweeperRecords = vi.mocked(getMinesweeperRecords);
  const mockGetRogueliteRecords = vi.mocked(getRogueliteRecords);
  const mockGetWhackMoleRecords = vi.mocked(getWhackMoleRecords);
  const mockGetUserLotteryRecords = vi.mocked(getUserLotteryRecords);

  beforeEach(() => {
    vi.clearAllMocks();

    mockKvLrange.mockResolvedValue([]);
    mockKvGet.mockResolvedValue(null);
    mockKvSet.mockResolvedValue('OK');
    mockKvDel.mockResolvedValue(1);
    mockGetLinkGameRecords.mockResolvedValue([]);
    mockGetMatch3Records.mockResolvedValue([]);
    mockGetMemoryRecords.mockResolvedValue([]);
    mockGetMinesweeperRecords.mockResolvedValue([]);
    mockGetRogueliteRecords.mockResolvedValue([]);
    mockGetWhackMoleRecords.mockResolvedValue([]);
    mockGetUserLotteryRecords.mockResolvedValue([]);
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
    mockGetTotalCheckinDays.mockResolvedValue(30);
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
      if (key === 'linkgame:records:1001') {
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

    expect(overview.user).toMatchObject({
      id: 1001,
      username: 'alice',
      customDisplayName: null,
      customAvatarUrl: null,
      customQqEmail: null,
    });
    expect(overview.points.balance).toBe(888);
    expect(overview.cards.owned).toBe(2);
    expect(overview.gameplay.checkinStreak).toBe(7);
    expect(overview.notifications.unreadCount).toBe(1);
    expect(overview.achievementStats).toMatchObject({
      gameWinRate: 0,
      gameWinPlays: 0,
      farmUnlockedLands: 0,
      lotteryOrangeCount: 0,
      lotteryHeartCount: 0,
    });
    expect(overview.achievements.items.some((item) => item.name === '连签 7 天' && item.unlocked)).toBe(true);
    expect(overview.gameplay.recentRecords[0]).toMatchObject({
      gameType: 'lottery',
      score: 5,
      createdAt: 2100,
    });
    expect(overview.gameplay.recentRecords[1]).toMatchObject({
      gameType: 'linkgame',
      score: 300,
      pointsEarned: 20,
      createdAt: 2000,
    });
  });
});
