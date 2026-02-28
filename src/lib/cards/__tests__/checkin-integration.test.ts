import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as checkinPOST } from '@/app/api/checkin/route';
import { POST as drawPOST } from '@/app/api/cards/draw/route';
import { kv } from '@/lib/d1-kv';
import { getAuthUser } from '@/lib/auth';
import { checkinToNewApi } from '@/lib/new-api';
import { cookies } from 'next/headers';
import { checkRateLimit } from '@/lib/rate-limit';
import { NextRequest, NextResponse } from 'next/server';

// Helper to create mock NextRequest
function createMockRequest(body: object = {}): NextRequest {
  return new NextRequest('http://localhost/api/cards/draw', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    incrby: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/new-api', () => ({
  checkinToNewApi: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  withRateLimit: vi.fn(),
  withUserRateLimit: vi.fn((_: string, handler: (request: Request, user: unknown, context: unknown) => Promise<Response>, options?: { unauthorizedMessage?: string }) => {
    return async (request: Request, context?: unknown) => {
      const { getAuthUser: getAuth } = await import('@/lib/auth');
      const user = await (getAuth as any)();
      if (!user) {
        return NextResponse.json(
          { success: false, message: options?.unauthorizedMessage ?? '未登录' },
          { status: 401 }
        );
      }
      return handler(request, user, context);
    };
  }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

describe('Checkin and Card Draw Integration', () => {
  const userId = 123;
  const user = { id: userId, username: 'testuser', displayName: 'Test User', isAdmin: false };
  const mockGetAuthUser = vi.mocked(getAuthUser);
  const mockCheckRateLimit = vi.mocked(checkRateLimit);
  const mockCheckinToNewApi = vi.mocked(checkinToNewApi);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvIncrby = vi.mocked(kv.incrby);
  const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue(user);
    mockCookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'mock_session' }),
    });
    mockCheckRateLimit.mockResolvedValue({ success: true, remaining: 10, resetAt: 0 });
    mockKvSet.mockResolvedValue('OK');
    mockKvIncrby.mockResolvedValue(1);
  });

  describe('Checkin awarding draws', () => {
    it('should award 1 card draw on successful checkin', async () => {
      // Setup: Not checked in yet
      // grantCheckinLocalRewards flow:
      //   1. kv.set(checkinKey, '1', {nx, ex}) -> 'OK' (not checked in yet)
      //   2. kv.get(cardsKey) -> null (no card data)
      //   3. kv.set(cardsKey, newCardData) -> saves card data with drawsAvailable: 1+5=6
      //   4. kv.incrby(extraSpinsKey, 1) -> returns 1
      mockKvGet.mockImplementation(async (key: string) => {
        if (key.includes('user:checkin')) return null;
        // cards:user key returns null (new user, no card data)
        if (key.includes('cards:user')) return null;
        return null;
      });
      // kv.set: first call for checkin NX returns 'OK', subsequent calls also 'OK'
      mockKvSet.mockResolvedValue('OK');
      mockKvIncrby.mockResolvedValue(1);
      mockCheckinToNewApi.mockResolvedValue({ success: true, message: '签到成功', quotaAwarded: 500000 });

      const response = await checkinPOST(createMockRequest(), undefined as any);
      const data = await response.json();

      expect(data.success).toBe(true);

      // Verify kv.set was called (checkin mark + card data)
      expect(kv.set).toHaveBeenCalled();
      // Verify kv.incrby was called for extra spins
      expect(kv.incrby).toHaveBeenCalled();
    });

    it('should not award extra draws if already checked in', async () => {
      // Setup: Already checked in - hasCheckedInToday returns true
      mockKvGet.mockImplementation(async (key: string) => {
        if (key.includes('user:checkin')) return true;
        return null;
      });

      const response = await checkinPOST(createMockRequest(), undefined as any);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.message).toContain('已经签到过了');

      // No card data updates should happen (kv.set only called for existing patterns, not for card draws)
      // The checkin route returns early before grantCheckinLocalRewards is called
      expect(kv.incrby).not.toHaveBeenCalled();
    });

    it('should return already checked when local lock is occupied after pre-check', async () => {
      // 模拟并发：预检查未签到，但发奖励时 checkin key 的 NX 抢占失败
      mockKvGet.mockImplementation(async (key: string) => {
        if (key.includes('user:checkin')) return null;
        if (key.includes('user:extra_spins')) return 2;
        if (key.includes('cards:user')) return { drawsAvailable: 6 };
        return null;
      });
      mockKvSet.mockResolvedValueOnce(null);
      mockCheckinToNewApi.mockResolvedValue({ success: true, message: '签到成功', quotaAwarded: 500000 });

      const response = await checkinPOST(createMockRequest(), undefined as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toContain('已经签到过了');
      expect(kv.incrby).not.toHaveBeenCalled();
    });

    it('should return already checked for new-api duplicate when local lock is occupied', async () => {
      // 模拟并发：new-api 提示已签到，福利站本地发奖励时发现当天已占用
      mockKvGet.mockImplementation(async (key: string) => {
        if (key.includes('user:checkin')) return null;
        if (key.includes('user:extra_spins')) return 2;
        if (key.includes('cards:user')) return { drawsAvailable: 6 };
        return null;
      });
      mockKvSet.mockResolvedValueOnce(null);
      mockCheckinToNewApi.mockResolvedValue({ success: false, message: '已签到' });

      const response = await checkinPOST(createMockRequest(), undefined as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toContain('已经签到过了');
      expect(kv.incrby).not.toHaveBeenCalled();
    });
  });

  describe('Draw API', () => {
    it('should allow drawing if draws available', async () => {
      const userData = {
        inventory: [],
        fragments: 0,
        pityCounter: 0,
        pityRare: 0,
        pityEpic: 0,
        pityLegendary: 0,
        pityLegendaryRare: 0,
        drawsAvailable: 1,
        collectionRewards: [],
      };

      // drawCard route first calls getUserCardData to check drawsAvailable
      // Then drawCard() calls reserveDraw (kv.get + kv.set) and finalizeDraw (kv.get + kv.set)
      mockKvGet
        .mockResolvedValueOnce(userData)  // getUserCardData check in route
        .mockResolvedValueOnce(userData)  // Phase 1: reserveDraw reads user data
        .mockResolvedValueOnce({          // Phase 2: finalizeDraw reads user data
          ...userData,
          drawsAvailable: 0,
          pityRare: 1,
          pityEpic: 1,
          pityLegendary: 1,
          pityLegendaryRare: 1,
          pityCounter: 1,
        });

      const response = await drawPOST(createMockRequest({ count: 1 }));
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data?.card).toBeDefined();
    });

    it('should return error if no draws available', async () => {
      const userData = {
        inventory: [],
        fragments: 0,
        pityCounter: 0,
        pityRare: 0,
        pityEpic: 0,
        pityLegendary: 0,
        pityLegendaryRare: 0,
        drawsAvailable: 0,
        collectionRewards: [],
      };

      // getUserCardData check in route sees 0 draws
      mockKvGet.mockResolvedValueOnce(userData);

      const response = await drawPOST(createMockRequest({ count: 1 }));
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.message).toContain('抽卡次数不足');
    });

    it('should require authentication', async () => {
      mockGetAuthUser.mockResolvedValue(null);

      const response = await drawPOST(createMockRequest({ count: 1 }));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
    });
  });
});
