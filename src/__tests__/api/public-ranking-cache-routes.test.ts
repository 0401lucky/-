import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockKv,
  mockGetLotteryDailyRanking,
  mockGetTodayDateString,
  mockGetKvAvailabilityStatus,
  mockGetKvErrorInsight,
} = vi.hoisted(() => ({
  mockKv: {
    zrange: vi.fn(),
    get: vi.fn(),
  },
  mockGetLotteryDailyRanking: vi.fn(),
  mockGetTodayDateString: vi.fn(),
  mockGetKvAvailabilityStatus: vi.fn(() => ({ available: true })),
  mockGetKvErrorInsight: vi.fn(() => ({ isUnavailable: false })),
}));

vi.mock('@/lib/d1-kv', () => ({
  kv: mockKv,
}));

vi.mock('@/lib/lottery', () => ({
  getLotteryDailyRanking: mockGetLotteryDailyRanking,
}));

vi.mock('@/lib/time', () => ({
  getTodayDateString: mockGetTodayDateString,
}));

vi.mock('@/lib/kv', () => ({
  buildKvUnavailablePayload: vi.fn((message: string) => ({ success: false, message })),
  getKvAvailabilityStatus: mockGetKvAvailabilityStatus,
  getKvErrorInsight: mockGetKvErrorInsight,
  KV_UNAVAILABLE_RETRY_AFTER_SECONDS: 60,
}));

import { GET as slotRankingGET } from '@/app/api/games/slot/ranking/route';
import { GET as lotteryRankingGET } from '@/app/api/lottery/ranking/route';

describe('Public ranking cache route handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTodayDateString.mockReturnValue('2026-03-09');
    mockGetLotteryDailyRanking.mockResolvedValue({
      date: '2026-03-09',
      totalParticipants: 1,
      ranking: [{ rank: 1, userId: '1', username: 'alice', totalValue: 5, bestPrize: '5刀福利', count: 1 }],
    });
    mockKv.zrange.mockResolvedValue(['u:1', 99]);
    mockKv.get.mockResolvedValue({ id: 1, username: 'alice' });
  });

  it('老虎机榜单接口返回 public 短缓存头并读取聚合 zrange', async () => {
    const response = await slotRankingGET(
      new NextRequest('http://localhost/api/games/slot/ranking?limit=10'),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=15, stale-while-revalidate=45');
    expect(data.success).toBe(true);
    expect(mockKv.zrange).toHaveBeenCalledWith('slot:rank:daily:2026-03-09', 0, 9, {
      rev: true,
      withScores: true,
    });
  });

  it('抽奖榜接口返回 public 短缓存头并复用 today date helper', async () => {
    const response = await lotteryRankingGET(
      new NextRequest('http://localhost/api/lottery/ranking?limit=10'),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=15, stale-while-revalidate=45');
    expect(data.success).toBe(true);
    expect(mockGetTodayDateString).toHaveBeenCalledTimes(1);
    expect(mockGetLotteryDailyRanking).toHaveBeenCalledWith(10, '2026-03-09');
  });
});
