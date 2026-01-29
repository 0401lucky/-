import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as checkinPOST } from '@/app/api/checkin/route';
import { POST as drawPOST } from '@/app/api/cards/draw/route';
import { kv } from '@vercel/kv';
import { getAuthUser } from '@/lib/auth';
import { checkinToNewApi } from '@/lib/new-api';
import { cookies } from 'next/headers';

vi.mock('@vercel/kv', () => ({
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
  });

  describe('Checkin awarding draws', () => {
    it('should award 1 card draw on successful checkin', async () => {
      // Setup: Not checked in yet
      (kv.get as any).mockImplementation((key: string) => {
        if (key.includes('user:checkin')) return null;
        if (key.includes('cards:user')) return null; // Default user card data
        return null;
      });
      (checkinToNewApi as any).mockResolvedValue({ success: true, quotaAwarded: 500000 });

      const response = await checkinPOST();
      const data = await response.json();

      expect(data.success).toBe(true);
      
      // Verify drawsAvailable was incremented
      // Since it's stored in cards:user:{userId} object, we expect a get and then a set
      expect(kv.set).toHaveBeenCalledWith(
        `cards:user:${userId}`,
        expect.objectContaining({ drawsAvailable: 11 }) // 10 (default) + 1
      );
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
      
      // kv.set for cards:user should NOT be called
      const cardSetCalls = (kv.set as any).mock.calls.filter((call: any[]) => call[0].startsWith('cards:user:'));
      expect(cardSetCalls.length).toBe(0);
    });
  });

  describe('Draw API', () => {
    it('should allow drawing if draws available', async () => {
      (kv.get as any).mockResolvedValue({
        inventory: [],
        fragments: 0,
        pityCounter: 0,
        drawsAvailable: 1,
        collectionRewards: [],
      });

      const response = await drawPOST();
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.card).toBeDefined();
      
      // Verify draw was consumed
      expect(kv.set).toHaveBeenCalledWith(
        `cards:user:${userId}`,
        expect.objectContaining({ drawsAvailable: 0 })
      );
    });

    it('should return error if no draws available', async () => {
      (kv.get as any).mockResolvedValue({
        inventory: [],
        fragments: 0,
        pityCounter: 0,
        drawsAvailable: 0,
        collectionRewards: [],
      });

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
