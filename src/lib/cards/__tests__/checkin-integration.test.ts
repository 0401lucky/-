import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as checkinPOST } from '@/app/api/checkin/route';
import { POST as drawPOST } from '@/app/api/cards/draw/route';
import { kv } from '@vercel/kv';
import { getAuthUser } from '@/lib/auth';
import { checkinToNewApi } from '@/lib/new-api';
import { cookies } from 'next/headers';
import { checkRateLimit } from '@/lib/rate-limit';
import { NextRequest } from 'next/server';

// Helper to create mock NextRequest
function createMockRequest(body: object = {}): NextRequest {
  return new NextRequest('http://localhost/api/cards/draw', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    incrby: vi.fn(),
    eval: vi.fn(),
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
  const mockKvEval = vi.mocked(kv.eval);
  const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue(user);
    mockCookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'mock_session' }),
    });
    mockCheckRateLimit.mockResolvedValue({ success: true, remaining: 10, resetAt: 0 });
  });

  describe('Checkin awarding draws', () => {
    it('should award 1 card draw on successful checkin', async () => {
      // Setup: Not checked in yet
      mockKvGet.mockImplementation((key: string) => {
        if (key.includes('user:checkin')) return null;
        return null;
      });
      mockCheckinToNewApi.mockResolvedValue({ success: true, quotaAwarded: 500000 });
      mockKvEval.mockResolvedValue([1, 1, 6, 'ok']);

      const response = await checkinPOST();
      const data = await response.json();

      expect(data.success).toBe(true);
      
      // Verify local rewards were granted via atomic Lua script
      expect(kv.eval).toHaveBeenCalled();
      const evalKeys = mockKvEval.mock.calls[0][1];
      expect(evalKeys[0]).toMatch(new RegExp(`^user:checkin:${userId}:`));
      expect(evalKeys[1]).toBe(`user:extra_spins:${userId}`);
      expect(evalKeys[2]).toBe(`cards:user:${userId}`);

      const evalArgs = mockKvEval.mock.calls[0][2];
      expect(evalArgs[2]).toBe(5);
    });

    it('should not award extra draws if already checked in', async () => {
      // Setup: Already checked in
      mockKvGet.mockImplementation((key: string) => {
        if (key.includes('user:checkin')) return true;
        return null;
      });

      const response = await checkinPOST();
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.message).toContain('已经签到过了');
      
      // No local rewards script should run
      expect(kv.eval).not.toHaveBeenCalled();
    });
  });

  describe('Draw API', () => {
    it('should allow drawing if draws available', async () => {
      // Mock kv.eval for two-phase draw:
      // Phase 1 (RESERVE_DRAW_SCRIPT): returns [success, pityRare, pityEpic, pityLegendary, pityLegendaryRare, status]
      // Phase 2 (FINALIZE_DRAW_SCRIPT): returns [success, status, fragmentsAdded]
      mockKvEval
        .mockResolvedValueOnce([1, 1, 1, 1, 1, 'ok']) // Reserve: success, all pity counters=1
        .mockResolvedValueOnce([1, 'ok', 0]); // Finalize: success, not duplicate

      const response = await drawPOST(createMockRequest({ count: 1 }));
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data?.card).toBeDefined();
    });

    it('should return error if no draws available', async () => {
      // Phase 1 returns failure (no draws)
      mockKvEval.mockResolvedValueOnce([0, 0, 0, 0, 0, 'no_draws']);

      const response = await drawPOST(createMockRequest({ count: 1 }));
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.message).toBe('抽卡次数不足');
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
