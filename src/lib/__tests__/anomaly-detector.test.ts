import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { getAllProjects, getAllUsers } from '../kv';
import { getUserPoints } from '../points';
import {
  getActiveAlerts,
  getDailyStats,
  resolveAlert,
  triggerAlert,
} from '../metrics';
import {
  getCachedAlertsSnapshot,
  getCachedDashboardOverview,
  getDashboardOverview,
  resolveAlertById,
  runAnomalyDetection,
} from '../anomaly-detector';
import { listAllFeedback } from '../feedback';
import { listPublishedAnnouncements } from '../announcements';
import { getActiveRaffles } from '../raffle';
import { getStoreItems } from '../store';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    lrange: vi.fn(),
    hgetall: vi.fn(),
  },
}));

vi.mock('../kv', () => ({
  getAllProjects: vi.fn(),
  getAllUsers: vi.fn(),
}));

vi.mock('../points', () => ({
  getUserPoints: vi.fn(),
}));

vi.mock('../metrics', () => ({
  triggerAlert: vi.fn(),
  resolveAlert: vi.fn(),
  getActiveAlerts: vi.fn(),
  getDailyStats: vi.fn(),
}));

vi.mock('../feedback', () => ({
  listAllFeedback: vi.fn(),
}));

vi.mock('../announcements', () => ({
  listPublishedAnnouncements: vi.fn(),
}));

vi.mock('../raffle', () => ({
  getActiveRaffles: vi.fn(),
}));

vi.mock('../store', () => ({
  getStoreItems: vi.fn(),
}));

vi.mock('../hot-d1', () => ({
  isNativeHotStoreReady: vi.fn(async () => false),
  getNativePointLogsInRange: vi.fn(),
}));

describe('anomaly detector', () => {
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvLrange = vi.mocked(kv.lrange);
  const mockGetAllProjects = vi.mocked(getAllProjects);
  const mockGetAllUsers = vi.mocked(getAllUsers);
  const mockGetUserPoints = vi.mocked(getUserPoints);
  const mockTriggerAlert = vi.mocked(triggerAlert);
  const mockResolveAlert = vi.mocked(resolveAlert);
  const mockGetActiveAlerts = vi.mocked(getActiveAlerts);
  const mockGetDailyStats = vi.mocked(getDailyStats);
  const mockListAllFeedback = vi.mocked(listAllFeedback);
  const mockListPublishedAnnouncements = vi.mocked(listPublishedAnnouncements);
  const mockGetActiveRaffles = vi.mocked(getActiveRaffles);
  const mockGetStoreItems = vi.mocked(getStoreItems);

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetAllUsers.mockResolvedValue([
      { id: 1001, username: 'alice', firstSeen: 1 },
      { id: 1002, username: 'bob', firstSeen: 1 },
    ]);
    mockGetAllProjects.mockResolvedValue([
      {
        id: 'project-1',
        name: '福利项目',
        description: '',
        maxClaims: 10,
        claimedCount: 4,
        codesCount: 10,
        status: 'active',
        createdAt: 1,
        createdBy: 'admin',
      },
      {
        id: 'project-2',
        name: '暂停项目',
        description: '',
        maxClaims: 5,
        claimedCount: 1,
        codesCount: 5,
        status: 'paused',
        createdAt: 1,
        createdBy: 'admin',
      },
    ]);
    mockGetActiveRaffles.mockResolvedValue([
      {
        id: 'raffle-1',
        title: '多人抽奖',
        description: '',
        prizes: [],
        triggerType: 'manual',
        threshold: 1,
        status: 'active',
        participantsCount: 0,
        winnersCount: 0,
        createdAt: 1,
      },
    ]);
    mockGetStoreItems.mockResolvedValue([
      {
        id: 'store-1',
        name: '抽奖机会',
        description: '',
        type: 'lottery_spin',
        pointsCost: 100,
        value: 1,
        sortOrder: 1,
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    mockListAllFeedback.mockImplementation(async (options) => ({
      items: [],
      pagination: {
        page: 1,
        limit: options?.limit ?? 1,
        total: options?.status === 'open' ? 3 : 2,
        totalPages: 1,
        hasMore: false,
      },
    }));
    mockListPublishedAnnouncements.mockResolvedValue({
      items: [],
      pagination: {
        page: 1,
        limit: 1,
        total: 4,
        totalPages: 4,
        hasMore: true,
      },
    });

    const kvData = new Map<string, unknown>();

    mockKvGet.mockImplementation(async (key: string) => {
      return (kvData.get(key) as unknown) ?? null;
    });

    mockKvSet.mockImplementation(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && kvData.has(key)) {
        return null;
      }
      kvData.set(key, value);
      return 'OK';
    });

    mockKvLrange.mockImplementation(async () => []);
    mockGetUserPoints.mockResolvedValue(100);
    mockTriggerAlert.mockResolvedValue();
    mockResolveAlert.mockResolvedValue();
    mockGetActiveAlerts.mockResolvedValue([]);
    mockGetDailyStats.mockResolvedValue({
      'claims.success': 3,
      'lottery.spin': 10,
      'lottery.spin.direct': 2,
      'users.checkin': 8,
      'cards.draw': 5,
      'cards.exchange': 1,
      'games.start': 7,
      'games.complete': 6,
    });
  });

  it('triggers anomaly alerts for points spike and high lottery frequency', async () => {
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'anomaly:baseline:points:1001') return 100;
      if (key === 'anomaly:baseline:points:1002') return 100;
      return null;
    });

    mockGetUserPoints
      .mockResolvedValueOnce(7000)
      .mockResolvedValueOnce(200);

    mockKvLrange.mockImplementation(async (key: string) => {
      if (key === 'lottery:user:records:1001') {
        return Array.from({ length: 100 }, (_, index) => ({ createdAt: Date.now() - index * 1000 }));
      }
      return [];
    });

    const result = await runAnomalyDetection();

    expect(result.scannedUsers).toBe(2);
    expect(result.triggeredAlerts).toBeGreaterThanOrEqual(2);
    expect(mockTriggerAlert).toHaveBeenCalled();
  });

  it('builds dashboard overview metrics', async () => {
    const now = Date.now();
    mockGetActiveAlerts.mockResolvedValue([
      { id: 'a1', level: 'warning', name: 'w', message: 'w', timestamp: now },
      { id: 'a2', level: 'critical', name: 'c', message: 'c', timestamp: now },
    ]);

    mockKvLrange.mockImplementation(async (key: string) => {
      if (key === 'points_log:1001') {
        return [{
          id: 'p1',
          amount: 30,
          source: 'checkin_bonus',
          description: '签到积分（周一 +30）',
          balance: 130,
          createdAt: now - 1000,
        }];
      }
      if (key === 'points_log:1002') {
        return [{
          id: 'p2',
          amount: -10,
          source: 'exchange',
          description: '购买动物卡抽卡次数 x1',
          balance: 90,
          createdAt: now - 1000,
        }];
      }
      if (key === 'linkgame:records:1001') {
        return [{ createdAt: now - 1000 }];
      }
      return [];
    });

    const result = await getDashboardOverview({ referenceTime: now });

    expect(result.users.total).toBe(2);
    expect(result.redemption.todayClaims).toBe(3);
    expect(result.operations.projects.active).toBe(1);
    expect(result.operations.projects.remainingSlots).toBe(6);
    expect(result.operations.raffles.active).toBe(1);
    expect(result.operations.feedback.open).toBe(3);
    expect(result.operations.announcements.published).toBe(4);
    expect(result.engagement.todayCheckins).toBe(8);
    expect(result.pointsFlow.todayIn).toBeGreaterThanOrEqual(30);
    expect(result.pointsAnalytics.period).toBe('day');
    expect(result.pointsAnalytics.earning.categories[0]).toMatchObject({
      key: 'checkin_bonus',
      total: 30,
      count: 1,
    });
    expect(result.pointsAnalytics.spending.categories[0]).toMatchObject({
      key: 'card_draw_purchase',
      total: 10,
      count: 1,
    });
    expect(result.alerts.warning).toBe(1);
    expect(result.alerts.critical).toBe(1);
  });

  it('reuses cached dashboard overview when snapshot is fresh', async () => {
    const now = Date.now();
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'dashboard:overview:cache:day') {
        return {
          createdAt: now,
          data: {
            generatedAt: now,
            users: { total: 9, dau: 4, mau: 7 },
            redemption: { todayClaims: 5, todayLotterySpins: 6 },
            engagement: {
              todayCheckins: 3,
              todayCardDraws: 2,
              todayCardExchanges: 1,
              todayGamesStarted: 8,
              todayGamesCompleted: 7,
            },
            operations: {
              projects: { total: 5, active: 2, remainingSlots: 20 },
              raffles: { active: 1 },
              store: { enabledItems: 4 },
              feedback: { open: 2, processing: 1 },
              announcements: { published: 3 },
            },
            pointsFlow: { todayIn: 10, todayOut: 3, todayNet: 7 },
            pointsAnalytics: {
              period: 'day',
              range: { startAt: now, endAt: now, label: '今日', bucketUnit: 'hour' },
              bucketLabels: [],
              earning: { total: 0, count: 0, userCount: 0, average: 0, categories: [], series: [] },
              spending: { total: 0, count: 0, userCount: 0, average: 0, categories: [], series: [] },
              meta: {
                storage: 'legacy',
                scannedUsers: 0,
                scannedLogs: 0,
                maxLogsPerUser: 5000,
                truncatedUsers: 0,
                truncatedLogs: false,
              },
            },
            games: { participants: 2, participationRate: 22.22 },
            alerts: { active: 1, warning: 1, critical: 0 },
          },
        };
      }
      return null;
    });

    const result = await getCachedDashboardOverview({ referenceTime: now + 1000 });

    expect(result.users.total).toBe(9);
    expect(mockGetAllUsers).not.toHaveBeenCalled();
  });

  it('reuses cached alerts snapshot when fresh', async () => {
    const now = Date.now();
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'dashboard:alerts:cache:20') {
        return {
          createdAt: now,
          data: {
            active: [{ id: 'a1', level: 'warning', name: 'warn', message: 'msg', timestamp: now }],
            history: [],
          },
        };
      }
      return null;
    });

    const result = await getCachedAlertsSnapshot({ historyLimit: 20 });

    expect(result.active).toHaveLength(1);
    expect(mockGetActiveAlerts).not.toHaveBeenCalled();
    expect(mockKvLrange).not.toHaveBeenCalled();
  });

  it('forwards resolve action', async () => {
    await resolveAlertById('alert-1');
    expect(mockResolveAlert).toHaveBeenCalledWith('alert-1');
  });
});
