import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockGetAllGamesLeaderboard,
  mockGetPointsLeaderboard,
  mockGetCheckinStreakLeaderboard,
  mockListRankingSettlementHistory,
  mockWithAuthenticatedUser,
  mockWithUserRateLimit,
  mockGetKvErrorInsight,
} = vi.hoisted(() => {
  const mockUser = {
    id: 1,
    username: 'alice',
    displayName: 'Alice',
    isAdmin: false,
  };

  return {
    mockUser,
    mockGetAllGamesLeaderboard: vi.fn(),
    mockGetPointsLeaderboard: vi.fn(),
    mockGetCheckinStreakLeaderboard: vi.fn(),
    mockListRankingSettlementHistory: vi.fn(),
    mockWithAuthenticatedUser: vi.fn(
      (handler: (request: Request, user: unknown, context: unknown) => Promise<Response>) => {
        return async (request: Request, context: unknown) => handler(request, mockUser, context);
      }
    ),
    mockWithUserRateLimit: vi.fn(() => {
      throw new Error('展示型排行榜 GET 不应继续使用 withUserRateLimit');
    }),
    mockGetKvErrorInsight: vi.fn(() => ({ isUnavailable: false })),
  };
});

vi.mock('@/lib/rankings', () => ({
  getAllGamesLeaderboard: mockGetAllGamesLeaderboard,
  getPointsLeaderboard: mockGetPointsLeaderboard,
  getCheckinStreakLeaderboard: mockGetCheckinStreakLeaderboard,
}));

vi.mock('@/lib/ranking-settlement', () => ({
  listRankingSettlementHistory: mockListRankingSettlementHistory,
}));

vi.mock('@/lib/rate-limit', () => ({
  withAuthenticatedUser: mockWithAuthenticatedUser,
  withUserRateLimit: mockWithUserRateLimit,
}));

vi.mock('@/lib/kv', () => ({
  buildKvUnavailablePayload: vi.fn((message: string) => ({ success: false, message })),
  getKvErrorInsight: mockGetKvErrorInsight,
  KV_UNAVAILABLE_RETRY_AFTER_SECONDS: 60,
}));

import { GET as gamesGET } from '@/app/api/rankings/games/route';
import { GET as pointsGET } from '@/app/api/rankings/points/route';
import { GET as checkinGET } from '@/app/api/rankings/checkin-streak/route';
import { GET as historyGET } from '@/app/api/rankings/history/route';

describe('Ranking cache route handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetAllGamesLeaderboard.mockResolvedValue({
      period: 'daily',
      generatedAt: 1,
      startAt: 1,
      games: [],
      overall: [],
    });
    mockGetPointsLeaderboard.mockResolvedValue({
      period: 'all',
      leaderboard: [],
      generatedAt: 1,
    });
    mockGetCheckinStreakLeaderboard.mockResolvedValue({
      period: 'all',
      leaderboard: [],
      generatedAt: 1,
    });
    mockListRankingSettlementHistory.mockResolvedValue({
      period: 'weekly',
      page: 1,
      limit: 5,
      total: 0,
      items: [],
    });
  });

  it('全游戏榜接口返回 private 短缓存头', async () => {
    const response = await gamesGET(
      new NextRequest('http://localhost/api/rankings/games?period=weekly&limit=10'),
      undefined as never
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=15, stale-while-revalidate=45');
    expect(data.success).toBe(true);
    expect(mockGetAllGamesLeaderboard).toHaveBeenCalledWith('weekly', {
      limitPerGame: 10,
      overallLimit: 10,
    });
  });

  it('积分榜接口使用仅鉴权包装并返回 private 短缓存头', async () => {
    const response = await pointsGET(
      new NextRequest('http://localhost/api/rankings/points?period=monthly&limit=8'),
      undefined as never
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=15, stale-while-revalidate=45');
    expect(data.success).toBe(true);
    expect(mockGetPointsLeaderboard).toHaveBeenCalledWith('monthly', 8);
  });

  it('签到榜接口使用仅鉴权包装并返回 private 短缓存头', async () => {
    const response = await checkinGET(
      new NextRequest('http://localhost/api/rankings/checkin-streak?period=monthly&limit=6'),
      undefined as never
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=15, stale-while-revalidate=45');
    expect(data.success).toBe(true);
    expect(mockGetCheckinStreakLeaderboard).toHaveBeenCalledWith('monthly', 6);
  });

  it('结算历史接口使用仅鉴权包装并返回 private 短缓存头', async () => {
    const response = await historyGET(
      new NextRequest('http://localhost/api/rankings/history?period=monthly&page=2&limit=5'),
      undefined as never
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=15, stale-while-revalidate=45');
    expect(data.success).toBe(true);
    expect(mockListRankingSettlementHistory).toHaveBeenCalledWith('monthly', { page: 2, limit: 5 });
  });
});
