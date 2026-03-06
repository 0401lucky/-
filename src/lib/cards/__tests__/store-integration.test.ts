import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as purchasePOST } from '@/app/api/cards/purchase/route';
import { getAuthUser } from '@/lib/auth';
import { CARD_DRAW_PRICE } from '@/lib/cards/constants';
import { checkRateLimit } from '@/lib/rate-limit';
import { addCardDraws } from '@/lib/kv';
import { addPoints, deductPoints } from '@/lib/points';

vi.mock('@/lib/kv', () => ({
  addCardDraws: vi.fn(),
}));

vi.mock('@/lib/points', () => ({
  addPoints: vi.fn(),
  deductPoints: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));

describe('Card Draw Store Integration', () => {
  const userId = 123;
  const user = { id: userId, username: 'testuser', displayName: 'Test User', isAdmin: false };
  const mockGetAuthUser = vi.mocked(getAuthUser);
  const mockCheckRateLimit = vi.mocked(checkRateLimit);
  const mockDeductPoints = vi.mocked(deductPoints);
  const mockAddCardDraws = vi.mocked(addCardDraws);
  const mockAddPoints = vi.mocked(addPoints);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue(user);
    mockCheckRateLimit.mockResolvedValue({ success: true, remaining: 10, resetAt: 0 });
    mockDeductPoints.mockResolvedValue({ success: true, balance: 100 });
    mockAddCardDraws.mockResolvedValue({ success: true, drawsAvailable: 11 });
    mockAddPoints.mockResolvedValue({ success: true, balance: CARD_DRAW_PRICE + 100 });
  });

  it('should successfully purchase a card draw with sufficient points', async () => {
    const response = await purchasePOST();
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.newBalance).toBe(100);
    expect(data.drawsAvailable).toBe(11);
    expect(mockDeductPoints).toHaveBeenCalledWith(userId, CARD_DRAW_PRICE, 'exchange', '购买动物卡抽卡次数 x1');
    expect(mockAddCardDraws).toHaveBeenCalledWith(userId, 1);
  });

  it('should fail to purchase with insufficient points', async () => {
    mockDeductPoints.mockResolvedValueOnce({ success: false, balance: 500, message: '积分不足' });

    const response = await purchasePOST();
    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.message).toBe('积分不足');
    expect(data.balance).toBe(500);
    expect(mockAddCardDraws).not.toHaveBeenCalled();
  });

  it('should require authentication', async () => {
    mockGetAuthUser.mockResolvedValue(null);

    const response = await purchasePOST();
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
  });
});
