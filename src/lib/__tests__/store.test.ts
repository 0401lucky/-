import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';
import type { StoreItem } from '../types/store';
import { exchangeItem } from '../store';
import { deductPoints, applyPointsDelta } from '../points';
import { addCardDraws } from '../kv';
import { creditQuotaToUser } from '../new-api';

vi.mock('@vercel/kv', () => ({
  kv: {
    hget: vi.fn(),
    eval: vi.fn(),
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
  const mockKvEval = vi.mocked(kv.eval);
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
    mockKvEval.mockResolvedValue([1, 1]);
    mockKvDecr.mockResolvedValue(0);
    mockKvLpush.mockResolvedValue(1);
    mockKvLtrim.mockResolvedValue(1);
    mockKvHincrby.mockResolvedValue(1);

    mockDeductPoints.mockResolvedValue({ success: true, balance: 9999 });
    mockApplyPointsDelta.mockResolvedValue({ success: true, balance: 9999 });
    mockAddCardDraws.mockResolvedValue({ success: true, message: 'ok' });
    mockCreditQuotaToUser.mockResolvedValue({ success: true, message: '充值成功' });
  });

  it('returns limit exceeded before deducting points', async () => {
    mockKvEval.mockResolvedValue([0, 1]);

    const result = await exchangeItem(1001, 'item-1');

    expect(result.success).toBe(false);
    expect(result.message).toContain('今日已达限购上限');
    expect(mockDeductPoints).not.toHaveBeenCalled();
    expect(mockKvDecr).not.toHaveBeenCalled();
  });

  it('does not rollback points or daily limit when direct credit is uncertain', async () => {
    mockCreditQuotaToUser.mockResolvedValue({
      success: false,
      message: '充值结果不确定',
      uncertain: true,
    });

    const result = await exchangeItem(1002, 'item-1');

    expect(result.success).toBe(false);
    expect(result.uncertain).toBe(true);
    expect(result.message).toContain('充值结果不确定');
    expect(mockApplyPointsDelta).not.toHaveBeenCalled();
    expect(mockKvDecr).not.toHaveBeenCalled();
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
    mockAddCardDraws.mockResolvedValue({ success: false, message: '发放失败' });

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
