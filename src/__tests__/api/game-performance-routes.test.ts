import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authState,
  mockGetUserPoints,
  mockGetDailyStats,
  mockGetDailyPointsLimit,
  mockSpinLotteryAuto,
  mockGetLotteryPageState,
  mockRecordUser,
  mockCreateUserNotification,
  mockUser,
} = vi.hoisted(() => {
  const mockUser = {
    id: 1,
    username: 'alice',
    displayName: 'Alice',
    isAdmin: false,
  };

  return {
    authState: { user: mockUser as typeof mockUser | null },
    mockUser,
    mockGetUserPoints: vi.fn(),
    mockGetDailyStats: vi.fn(),
    mockGetDailyPointsLimit: vi.fn(),
    mockSpinLotteryAuto: vi.fn(),
    mockGetLotteryPageState: vi.fn(),
    mockRecordUser: vi.fn(),
    mockCreateUserNotification: vi.fn(),
  };
});

vi.mock('@/lib/points', () => ({
  getUserPoints: mockGetUserPoints,
}));

vi.mock('@/lib/daily-stats', () => ({
  getDailyStats: mockGetDailyStats,
}));

vi.mock('@/lib/config', () => ({
  getDailyPointsLimit: mockGetDailyPointsLimit,
}));

vi.mock('@/lib/lottery', () => ({
  spinLotteryAuto: mockSpinLotteryAuto,
  getLotteryPageState: mockGetLotteryPageState,
}));

vi.mock('@/lib/kv', () => ({
  recordUser: mockRecordUser,
}));

vi.mock('@/lib/notifications', () => ({
  createUserNotification: mockCreateUserNotification,
}));

vi.mock('@/lib/rate-limit', () => ({
  withAuthenticatedUser: vi.fn(
    (handler: (request: Request, user: unknown, context: unknown) => Promise<Response>, options?: { unauthorizedMessage?: string }) => {
      return async (request: Request, context?: unknown) => {
        if (!authState.user) {
          return Response.json(
            { success: false, message: options?.unauthorizedMessage ?? '未登录' },
            { status: 401 }
          );
        }
        return handler(request, authState.user, context);
      };
    }
  ),
  withUserRateLimit: vi.fn(
    (_action: string, handler: (request: Request, user: unknown, context: unknown) => Promise<Response>, options?: { unauthorizedMessage?: string }) => {
      return async (request: Request, context?: unknown) => {
        if (!authState.user) {
          return Response.json(
            { success: false, message: options?.unauthorizedMessage ?? '未登录' },
            { status: 401 }
          );
        }
        return handler(request, authState.user, context);
      };
    }
  ),
}));

import { GET as overviewGET } from '@/app/api/games/overview/route';
import { POST as lotterySpinPOST } from '@/app/api/lottery/spin/route';

describe('Game performance route handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = mockUser;
    mockGetUserPoints.mockResolvedValue(666);
    mockGetDailyStats.mockResolvedValue({
      userId: 1,
      date: '2026-03-09',
      gamesPlayed: 7,
      totalScore: 350,
      pointsEarned: 188,
      lastGameAt: 123,
    });
    mockGetDailyPointsLimit.mockResolvedValue(2000);
    mockSpinLotteryAuto.mockResolvedValue({
      success: true,
      message: '恭喜获得 5刀福利！',
      record: {
        id: 'lottery-1',
        tierName: '5刀福利',
        tierValue: 5,
        code: 'CODE-123',
        directCredit: false,
        createdAt: 123,
      },
    });
    mockGetLotteryPageState.mockResolvedValue({
      canSpin: false,
      hasSpunToday: true,
      extraSpins: 0,
    });
    mockRecordUser.mockResolvedValue(undefined);
    mockCreateUserNotification.mockResolvedValue(undefined);
  });

  it('游戏中心概览接口仅返回首屏所需轻量字段', async () => {
    const response = await overviewGET(new NextRequest('http://localhost/api/games/overview'), undefined as never);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      data: {
        balance: 666,
        dailyStats: {
          gamesPlayed: 7,
          pointsEarned: 188,
        },
        dailyLimit: 2000,
        pointsLimitReached: false,
      },
    });
  });

  it('未登录时游戏中心概览接口返回 401', async () => {
    authState.user = null;

    const response = await overviewGET(new NextRequest('http://localhost/api/games/overview'), undefined as never);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ success: false, message: '未登录' });
  });

  it('抽奖接口直接返回中奖记录并异步刷新页面状态', async () => {
    const response = await lotterySpinPOST(
      new NextRequest('http://localhost/api/lottery/spin', {
        method: 'POST',
      }),
      undefined as never
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockSpinLotteryAuto).toHaveBeenCalledWith(1, 'alice', {
      bypassSpinLimit: false,
    });
    expect(mockGetLotteryPageState).not.toHaveBeenCalled();
    expect(mockRecordUser).toHaveBeenCalledWith(1, 'alice');
    expect(mockCreateUserNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        type: 'lottery_win',
        title: '抽奖中奖通知',
      })
    );
    expect(data).toMatchObject({
      success: true,
      record: {
        tierName: '5刀福利',
      },
    });
  });

});
