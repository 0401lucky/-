import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authState,
  mockUser,
  mockStartTowerGame,
  mockBuildTowerSessionView,
  mockStepTowerGame,
  mockSubmitTowerResult,
  mockGetAuthUser,
  mockGetUserPoints,
  mockGetDailyStats,
  mockGetActiveTowerSession,
  mockIsInCooldown,
  mockGetCooldownRemaining,
  mockGetDailyPointsLimit,
  mockGetTowerRecords,
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
    mockStartTowerGame: vi.fn(),
    mockBuildTowerSessionView: vi.fn(),
    mockStepTowerGame: vi.fn(),
    mockSubmitTowerResult: vi.fn(),
    mockGetAuthUser: vi.fn(),
    mockGetUserPoints: vi.fn(),
    mockGetDailyStats: vi.fn(),
    mockGetActiveTowerSession: vi.fn(),
    mockIsInCooldown: vi.fn(),
    mockGetCooldownRemaining: vi.fn(),
    mockGetDailyPointsLimit: vi.fn(),
    mockGetTowerRecords: vi.fn(),
  };
});

vi.mock('@/lib/game-route-factory', () => ({
  createStartRoute: vi.fn((handler: (request: Request, ctx: { user: unknown }) => Promise<Response | Record<string, unknown>>, options?: { unauthorizedMessage?: string }) => ({
    POST: async (request: Request) => {
      if (!authState.user) {
        return Response.json(
          { success: false, message: options?.unauthorizedMessage ?? '未登录' },
          { status: 401 },
        );
      }

      const result = await handler(request, { user: authState.user });
      if (result instanceof Response) {
        return result;
      }

      return Response.json({ success: true, data: result });
    },
  })),
  fail: (message: string, status = 400) => Response.json({ success: false, message }, { status }),
}));

vi.mock('@/lib/rate-limit', () => ({
  withUserRateLimit: vi.fn(
    (_action: string, handler: (request: Request, user: unknown, context: unknown) => Promise<Response>, options?: { unauthorizedMessage?: string }) =>
      async (request: Request, context?: unknown) => {
        if (!authState.user) {
          return Response.json(
            { success: false, message: options?.unauthorizedMessage ?? '未登录' },
            { status: 401 },
          );
        }

        return handler(request, authState.user, context);
      },
  ),
}));

vi.mock('@/lib/auth', () => ({
  getAuthUser: mockGetAuthUser,
}));

vi.mock('@/lib/points', () => ({
  getUserPoints: mockGetUserPoints,
}));

vi.mock('@/lib/config', () => ({
  getDailyPointsLimit: mockGetDailyPointsLimit,
}));

vi.mock('@/lib/tower', () => ({
  startTowerGame: mockStartTowerGame,
  buildTowerSessionView: mockBuildTowerSessionView,
  stepTowerGame: mockStepTowerGame,
  submitTowerResult: mockSubmitTowerResult,
  getActiveTowerSession: mockGetActiveTowerSession,
  getCooldownRemaining: mockGetCooldownRemaining,
  getDailyStats: mockGetDailyStats,
  getTowerRecords: mockGetTowerRecords,
  isInCooldown: mockIsInCooldown,
}));

import { POST as startPOST } from '@/app/api/games/tower/start/route';
import { POST as stepPOST } from '@/app/api/games/tower/step/route';
import { POST as submitPOST } from '@/app/api/games/tower/submit/route';
import { GET as statusGET } from '@/app/api/games/tower/status/route';

describe('Tower route handlers', () => {
  const sessionView = {
    sessionId: 'tower-session-1',
    startedAt: 100,
    expiresAt: 200,
    difficulty: 'normal',
    floorNumber: 1,
    choicesCount: 0,
    currentFloor: {
      floor: 1,
      lanes: [{ type: 'mystery' }, { type: 'monster', value: 1 }],
    },
    player: {
      power: 1,
      shield: 0,
      combo: 0,
      maxCombo: 0,
      buffs: [],
      blessings: [],
      curses: [],
      bossesDefeated: 0,
      usedShield: false,
      themeFloorsVisited: [],
    },
    gameOver: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = mockUser;
    mockGetAuthUser.mockResolvedValue(mockUser);
    mockBuildTowerSessionView.mockReturnValue(sessionView);
    mockGetUserPoints.mockResolvedValue(666);
    mockGetDailyStats.mockResolvedValue({
      userId: 1,
      date: '2026-04-10',
      gamesPlayed: 3,
      totalScore: 120,
      pointsEarned: 80,
      lastGameAt: 123,
    });
    mockGetActiveTowerSession.mockResolvedValue({ id: 'tower-session-1', seed: 'secret-seed' });
    mockIsInCooldown.mockResolvedValue(false);
    mockGetCooldownRemaining.mockResolvedValue(0);
    mockGetDailyPointsLimit.mockResolvedValue(2000);
    mockGetTowerRecords.mockResolvedValue([]);
  });

  it('start 路由返回客户端视图，不暴露 seed', async () => {
    mockStartTowerGame.mockResolvedValue({
      success: true,
      session: { id: 'tower-session-1', seed: 'secret-seed' },
    });

    const response = await startPOST(
      new NextRequest('http://localhost/api/games/tower/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty: 'normal' }),
      }),
      undefined as never,
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockStartTowerGame).toHaveBeenCalledWith(1, 'normal');
    expect(data.data.seed).toBeUndefined();
    expect(data.data.currentFloor.lanes[0]).toEqual({ type: 'mystery' });
  });

  it('status 路由返回客户端视图，不暴露 seed', async () => {
    const response = await statusGET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.activeSession.seed).toBeUndefined();
    expect(data.data.activeSession.currentFloor.lanes[0]).toEqual({ type: 'mystery' });
  });

  it('step 路由透传新的 step 协议', async () => {
    mockStepTowerGame.mockResolvedValue({
      success: true,
      session: sessionView,
      outcome: {
        selectedLane: { type: 'add', value: 3 },
        gameOver: false,
        blockedByShield: false,
        bossDefeated: false,
        expiredBlessings: [],
        expiredCurses: [],
      },
    });

    const response = await stepPOST(
      new NextRequest('http://localhost/api/games/tower/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'tower-session-1', laneIndex: 0 }),
      }),
      undefined as never,
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockStepTowerGame).toHaveBeenCalledWith(1, {
      sessionId: 'tower-session-1',
      laneIndex: 0,
    });
    expect(data.data.outcome.selectedLane).toEqual({ type: 'add', value: 3 });
  });

  it('submit 路由只要求 sessionId', async () => {
    mockSubmitTowerResult.mockResolvedValue({
      success: true,
      record: {
        id: 'record-1',
        floorsClimbed: 12,
        finalPower: 88,
        gameOver: false,
        score: 456,
      },
      pointsEarned: 456,
    });

    const response = await submitPOST(
      new NextRequest('http://localhost/api/games/tower/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'tower-session-1' }),
      }),
      undefined as never,
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockSubmitTowerResult).toHaveBeenCalledWith(1, { sessionId: 'tower-session-1' });
    expect(data.success).toBe(true);
  });
});
