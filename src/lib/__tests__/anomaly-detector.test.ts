import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';
import { getAllUsers } from '../kv';
import { getUserPoints } from '../points';
import {
  getActiveAlerts,
  getDailyStats,
  resolveAlert,
  triggerAlert,
} from '../metrics';
import {
  getDashboardOverview,
  resolveAlertById,
  runAnomalyDetection,
} from '../anomaly-detector';

vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    lrange: vi.fn(),
    hgetall: vi.fn(),
  },
}));

vi.mock('../kv', () => ({
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

describe('anomaly detector', () => {
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvLrange = vi.mocked(kv.lrange);
  const mockGetAllUsers = vi.mocked(getAllUsers);
  const mockGetUserPoints = vi.mocked(getUserPoints);
  const mockTriggerAlert = vi.mocked(triggerAlert);
  const mockResolveAlert = vi.mocked(resolveAlert);
  const mockGetActiveAlerts = vi.mocked(getActiveAlerts);
  const mockGetDailyStats = vi.mocked(getDailyStats);

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetAllUsers.mockResolvedValue([
      { id: 1001, username: 'alice', firstSeen: 1 },
      { id: 1002, username: 'bob', firstSeen: 1 },
    ]);

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
        return [{ amount: 30, createdAt: now - 1000 }];
      }
      if (key === 'points_log:1002') {
        return [{ amount: -10, createdAt: now - 1000 }];
      }
      if (key === 'slot:records:1001') {
        return [{ createdAt: now - 1000 }];
      }
      return [];
    });

    const result = await getDashboardOverview({ referenceTime: now });

    expect(result.users.total).toBe(2);
    expect(result.redemption.todayClaims).toBe(3);
    expect(result.pointsFlow.todayIn).toBeGreaterThanOrEqual(30);
    expect(result.alerts.warning).toBe(1);
    expect(result.alerts.critical).toBe(1);
  });

  it('forwards resolve action', async () => {
    await resolveAlertById('alert-1');
    expect(mockResolveAlert).toHaveBeenCalledWith('alert-1');
  });
});
