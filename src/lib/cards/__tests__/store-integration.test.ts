import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as purchasePOST } from '@/app/api/cards/purchase/route';
import { kv } from '@vercel/kv';
import { getAuthUser } from '@/lib/auth';
import { cookies } from 'next/headers';
import { CARD_DRAW_PRICE } from '@/lib/cards/constants';
import { checkRateLimit } from '@/lib/rate-limit';

vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(),
    eval: vi.fn(),
    lpush: vi.fn(),
    ltrim: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

describe('Card Draw Store Integration', () => {
  const userId = 123;
  const user = { id: userId, username: 'testuser', displayName: 'Test User', isAdmin: false };
  const mockGetAuthUser = vi.mocked(getAuthUser);
  const mockCheckRateLimit = vi.mocked(checkRateLimit);
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

  it('should successfully purchase a card draw with sufficient points', async () => {
    // Mock Lua script success result [1, newBalance, newDraws]
    mockKvEval.mockResolvedValue([1, 100, 11]);

    const response = await purchasePOST();
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.newBalance).toBe(100);
    expect(data.drawsAvailable).toBe(11);
    
    // Verify eval was called with correct keys and args
    expect(kv.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call'),
      [`points:${userId}`, `cards:user:${userId}`],
      [CARD_DRAW_PRICE, 1]
    );

    // Verify points log was created
    expect(kv.lpush).toHaveBeenCalledWith(
      `points_log:${userId}`,
      expect.objectContaining({
        amount: -CARD_DRAW_PRICE,
        source: 'exchange',
        description: '购买动物卡抽卡次数 x1',
      })
    );
  });

  it('should fail to purchase with insufficient points', async () => {
    // Mock Lua script failure result [0, currentBalance]
    mockKvEval.mockResolvedValue([0, 500]);

    const response = await purchasePOST();
    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.message).toBe('积分不足');
    expect(data.balance).toBe(500);
  });

  it('should require authentication', async () => {
    mockGetAuthUser.mockResolvedValue(null);

    const response = await purchasePOST();
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
  });
});
