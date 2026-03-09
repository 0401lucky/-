import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authState,
  mockGetUserPoints,
  mockGetDailyStats,
  mockGetDailyPointsLimit,
  mockSubmitGameResult,
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
    mockSubmitGameResult: vi.fn(),
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

vi.mock('@/lib/game', () => ({
  submitGameResult: mockSubmitGameResult,
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
import { POST as pachinkoSubmitPOST } from '@/app/api/games/pachinko/submit/route';
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
    mockSubmitGameResult.mockResolvedValue({
      success: true,
      message: '提交成功',
      record: {
        id: 'record-1',
        userId: 1,
        sessionId: 'session-1',
        gameType: 'pachinko',
        score: 30,
        pointsEarned: 15,
        duration: 60000,
        balls: [5, 5, 5, 5, 10],
        createdAt: 1,
      },
      balance: 120,
      dailyStats: {
        userId: 1,
        date: '2026-03-09',
        gamesPlayed: 3,
        totalScore: 90,
        pointsEarned: 45,
        lastGameAt: 2,
      },
    });
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

  it('抽奖接口直接返回中奖记录与最新页面状态', async () => {
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
    expect(mockGetLotteryPageState).toHaveBeenCalledWith(1, {
      bypassSpinLimit: false,
    });
    expect(mockRecordUser).toHaveBeenCalledWith(1, 'alice');
    expect(mockCreateUserNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        type: 'lottery_win',
        title: '抽奖中奖通知',
      })
    );
  });

  it('弹珠机结算接口直接透传即时余额与日统计', async () => {
    const balls = [
      { angle: 0, power: 0.65, slotScore: 5, duration: 1200 },
      { angle: 5, power: 0.7, slotScore: 5, duration: 1300 },
      { angle: -3, power: 0.75, slotScore: 5, duration: 1400 },
      { angle: 8, power: 0.8, slotScore: 5, duration: 1500 },
      { angle: -9, power: 0.85, slotScore: 10, duration: 1600 },
    ];

    const response = await pachinkoSubmitPOST(
      new NextRequest('http://localhost/api/games/pachinko/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'session-1',
          score: 30,
          duration: 60000,
          balls,
        }),
      }),
      undefined as never
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockSubmitGameResult).toHaveBeenCalledWith(1, {
      sessionId: 'session-1',
      score: 30,
      duration: 60000,
      balls,
    });
    expect(data.success).toBe(true);
    expect(data.data).toMatchObject({
      pointsEarned: 15,
      newBalance: 120,
      dailyStats: {
        gamesPlayed: 3,
        pointsEarned: 45,
      },
    });
  });
});
