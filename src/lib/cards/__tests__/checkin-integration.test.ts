import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as checkinPOST } from '@/app/api/checkin/route';
import { POST as drawPOST } from '@/app/api/cards/draw/route';
import { kv } from '@vercel/kv';
import { getAuthUser } from '@/lib/auth';
import { checkinToNewApi } from '@/lib/new-api';
import { cookies } from 'next/headers';
import { checkRateLimit } from '@/lib/rate-limit';

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

  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthUser as any).mockResolvedValue(user);
    (cookies as any).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'mock_session' }),
    });
    (checkRateLimit as any).mockResolvedValue({ success: true, remaining: 10, resetAt: 0 });
  });

  describe('Checkin awarding draws', () => {
    it('should award 1 card draw on successful checkin', async () => {
      // Setup: Not checked in yet
      (kv.get as any).mockImplementation((key: string) => {
        if (key.includes('user:checkin')) return null;
        return null;
      });
      (checkinToNewApi as any).mockResolvedValue({ success: true, quotaAwarded: 500000 });
      (kv.eval as any).mockResolvedValue([1, 1, 11, 'ok']);

      const response = await checkinPOST();
      const data = await response.json();

      expect(data.success).toBe(true);
      
      // Verify local rewards were granted via atomic Lua script
      expect(kv.eval).toHaveBeenCalled();
      const evalKeys = (kv.eval as any).mock.calls[0][1];
      expect(evalKeys[0]).toMatch(new RegExp(`^user:checkin:${userId}:`));
      expect(evalKeys[1]).toBe(`user:extra_spins:${userId}`);
      expect(evalKeys[2]).toBe(`cards:user:${userId}`);
    });

    it('should not award extra draws if already checked in', async () => {
      // Setup: Already checked in
      (kv.get as any).mockImplementation((key: string) => {
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
      // Phase 1 (RESERVE_DRAW_SCRIPT): returns [success, pityCounter, status]
      // Phase 2 (FINALIZE_DRAW_SCRIPT): returns [success, status, fragmentsAdded]
      (kv.eval as any)
        .mockResolvedValueOnce([1, 1, 'ok']) // Reserve: success, pityCounter=1
        .mockResolvedValueOnce([1, 'ok', 0]); // Finalize: success, not duplicate

      const response = await drawPOST();
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.card).toBeDefined();
    });

    it('should return error if no draws available', async () => {
      // Phase 1 returns failure (no draws)
      (kv.eval as any).mockResolvedValueOnce([0, 0, 'no_draws']);

      const response = await drawPOST();
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.message).toBe('抽卡次数不足');
    });

    it('should require authentication', async () => {
      (getAuthUser as any).mockResolvedValue(null);

      const response = await drawPOST();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
    });
  });
});
