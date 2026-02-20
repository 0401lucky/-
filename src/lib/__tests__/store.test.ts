import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import type { StoreItem } from '../types/store';
import { exchangeItem } from '../store';
import { deductPoints, applyPointsDelta } from '../points';
import { addCardDraws } from '../kv';
import { creditQuotaToUser } from '../new-api';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    hget: vi.fn(),
    incrby: vi.fn(),
    expire: vi.fn(),
    decrby: vi.fn(),
    decr: vi.fn(),
    lpush: vi.fn(),
    ltrim: vi.fn(),
    hincrby: vi.fn(),
  },
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-log-id'),
}));

vi.mock('../points', () => ({
  deductPoints: vi.fn(),
  applyPointsDelta: vi.fn(),
}));

vi.mock('../kv', () => ({
  addExtraSpinCount: vi.fn(),
  addCardDraws: vi.fn(),
}));

vi.mock('../new-api', () => ({
  creditQuotaToUser: vi.fn(),
}));

vi.mock('../time', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../time')>();
  return {
    ...mod,
    getTodayDateString: vi.fn(() => '2026-02-11'),
  };
});

describe('exchangeItem store safety', () => {
  const mockKvHget = vi.mocked(kv.hget);
  const mockKvIncrby = vi.mocked(kv.incrby);
  const mockKvExpire = vi.mocked(kv.expire);
  const mockKvDecrby = vi.mocked(kv.decrby);
  const mockKvDecr = vi.mocked(kv.decr);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockKvLtrim = vi.mocked(kv.ltrim);
  const mockKvHincrby = vi.mocked(kv.hincrby);

  const mockDeductPoints = vi.mocked(deductPoints);
  const mockApplyPointsDelta = vi.mocked(applyPointsDelta);
  const mockAddCardDraws = vi.mocked(addCardDraws);
  const mockCreditQuotaToUser = vi.mocked(creditQuotaToUser);

  const baseItem: StoreItem = {
    id: 'item-1',
    name: '账户额度 $1',
    description: '测试商品',
    type: 'quota_direct',
    pointsCost: 3500,
    value: 1,
    dailyLimit: 1,
    sortOrder: 1,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mockKvHget.mockResolvedValue(baseItem);
    // D1-compatible daily limit check: incrby returns newCount=1 (first purchase), within limit
    mockKvIncrby.mockResolvedValue(1);
    mockKvExpire.mockResolvedValue(1);
    mockKvDecrby.mockResolvedValue(0);
    mockKvDecr.mockResolvedValue(0);
    mockKvLpush.mockResolvedValue(1);
    mockKvLtrim.mockResolvedValue('OK' as any);
    mockKvHincrby.mockResolvedValue(1);

    mockDeductPoints.mockResolvedValue({ success: true, balance: 9999 });
    mockApplyPointsDelta.mockResolvedValue({ success: true, balance: 9999 });
    mockAddCardDraws.mockResolvedValue({ success: true, drawsAvailable: 1 });
    mockCreditQuotaToUser.mockResolvedValue({ success: true, message: '充值成功' });
  });

  it('returns limit exceeded before deducting points', async () => {
    // D1-compatible: incrby returns 2 which exceeds dailyLimit of 1, so decrby is called to rollback
    mockKvIncrby.mockResolvedValue(2);

    const result = await exchangeItem(1001, 'item-1');

    expect(result.success).toBe(false);
    expect(result.message).toContain('今日已达限购上限');
    expect(mockDeductPoints).not.toHaveBeenCalled();
    expect(mockKvDecrby).toHaveBeenCalledTimes(1); // rollback the incrby
  });

  it('does not rollback points or daily limit when direct credit is uncertain', async () => {
    mockCreditQuotaToUser.mockResolvedValue({
      success: false,
      message: '充值结果不确定',
      uncertain: true,
    } as any);

    const result = await exchangeItem(1002, 'item-1');

    expect(result.success).toBe(true);
    expect(result.uncertain).toBe(true);
    expect(result.message).toContain('充值结果不确定');
    expect(mockApplyPointsDelta).not.toHaveBeenCalled();
    expect(mockKvDecr).not.toHaveBeenCalled();
    expect(mockKvHincrby).toHaveBeenCalled();
  });

  it('rolls back points and daily limit when reward delivery fails', async () => {
    const cardDrawItem: StoreItem = {
      ...baseItem,
      id: 'item-2',
      name: '卡牌抽奖 x1',
      type: 'card_draw',
      pointsCost: 100,
      value: 1,
    };
    mockKvHget.mockResolvedValue(cardDrawItem);
    mockAddCardDraws.mockResolvedValue({ success: false, drawsAvailable: 0 } as any);

    const result = await exchangeItem(1003, 'item-2');

    expect(result.success).toBe(false);
    expect(result.message).toContain('卡牌抽奖次数增加失败');
    expect(mockKvDecr).toHaveBeenCalledTimes(1);
    expect(mockApplyPointsDelta).toHaveBeenCalledWith(
      1003,
      cardDrawItem.pointsCost,
      'exchange_refund',
      expect.stringContaining('兑换失败积分回滚')
    );
  });
});
