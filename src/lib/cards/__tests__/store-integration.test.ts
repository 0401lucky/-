import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as purchasePOST } from '@/app/api/cards/purchase/route';
import { kv } from '@/lib/d1-kv';
import { getAuthUser } from '@/lib/auth';
import { cookies } from 'next/headers';
import { CARD_DRAW_PRICE } from '@/lib/cards/constants';
import { checkRateLimit } from '@/lib/rate-limit';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    decrby: vi.fn(),
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
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvDecrby = vi.mocked(kv.decrby);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue(user);
    mockCookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'mock_session' }),
    });
    mockCheckRateLimit.mockResolvedValue({ success: true, remaining: 10, resetAt: 0 });
    mockKvSet.mockResolvedValue('OK');
    mockKvLpush.mockResolvedValue(1);
  });

  it('should successfully purchase a card draw with sufficient points', async () => {
    // D1-compatible: kv.get returns current points balance (sufficient), then card data
    mockKvGet
      .mockResolvedValueOnce(CARD_DRAW_PRICE + 100) // current points balance (sufficient)
      .mockResolvedValueOnce({ inventory: [], fragments: 0, pityCounter: 0, drawsAvailable: 10, collectionRewards: [] }); // current card data
    mockKvDecrby.mockResolvedValue(100); // new balance after deduction

    const response = await purchasePOST();
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.newBalance).toBe(100);
    expect(data.drawsAvailable).toBe(11);

    // Verify kv.get was called to check balance
    expect(kv.get).toHaveBeenCalledWith(`points:${userId}`);
    // Verify kv.decrby was called to deduct points
    expect(kv.decrby).toHaveBeenCalledWith(`points:${userId}`, CARD_DRAW_PRICE);
    // Verify kv.set was called to update card data with incremented draws
    expect(kv.set).toHaveBeenCalledWith(
      `cards:user:${userId}`,
      expect.objectContaining({
        drawsAvailable: 11,
      })
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
    // D1-compatible: kv.get returns insufficient points balance
    mockKvGet.mockResolvedValueOnce(500); // current balance less than CARD_DRAW_PRICE

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
