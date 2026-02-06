import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import { creditQuotaToUser } from '../new-api';
import { executeRaffleDraw, joinRaffle, retryFailedRewards } from '../raffle';

vi.mock('@vercel/kv', () => ({
  kv: {
    set: vi.fn(),
    get: vi.fn(),
    lrange: vi.fn(),
    srem: vi.fn(),
    eval: vi.fn(),
    lpush: vi.fn(),
  },
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(),
}));

vi.mock('../new-api', () => ({
  creditQuotaToUser: vi.fn(),
}));

describe('raffle robustness', () => {
  const mockKvSet = vi.mocked(kv.set);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvLrange = vi.mocked(kv.lrange);
  const mockKvSrem = vi.mocked(kv.srem);
  const mockKvEval = vi.mocked(kv.eval);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockNanoid = vi.mocked(nanoid);
  const mockCreditQuotaToUser = vi.mocked(creditQuotaToUser);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockNanoid.mockReturnValue('mock-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks join when draw lock exists', async () => {
    mockKvEval.mockResolvedValue([0, '', '活动正在开奖，请稍后再试', 0]);

    const result = await joinRaffle('raffle-1', 1001, 'alice');

    expect(result).toEqual({ success: false, message: '活动正在开奖，请稍后再试' });
    expect(mockKvEval).toHaveBeenCalledWith(
      expect.any(String),
      [
        'raffle:raffle-1',
        'raffle:entries:raffle-1',
        'raffle:participants:raffle-1',
        'raffle:entry_count:raffle-1',
        'user:raffles:1001',
        'raffle:draw_lock:raffle-1',
      ],
      expect.any(Array)
    );
  });

  it('always releases draw lock when retry read fails', async () => {
    mockKvSet.mockResolvedValue('OK');
    mockKvGet.mockRejectedValue(new Error('kv get failed'));
    mockKvEval.mockResolvedValue(1);

    await expect(retryFailedRewards('raffle-2')).rejects.toThrow('kv get failed');
    expect(mockKvEval).toHaveBeenCalledWith(
      expect.any(String),
      ['raffle:draw_lock:raffle-2'],
      ['mock-token']
    );
  });

  it('keeps delivered status when user-win logging fails', async () => {
    const raffleBeforeDraw = {
      id: 'raffle-3',
      title: '测试活动',
      description: 'desc',
      prizes: [
        { id: 'prize-1', name: '一等奖', dollars: 10, quantity: 1 },
      ],
      triggerType: 'manual' as const,
      threshold: 1,
      status: 'active' as const,
      participantsCount: 1,
      winnersCount: 0,
      createdBy: 1,
      createdAt: 1,
      updatedAt: 1,
    };

    const endedRaffleForDelivery = {
      ...raffleBeforeDraw,
      status: 'ended' as const,
      winnersCount: 1,
      winners: [
        {
          entryId: 'entry-1',
          userId: 1001,
          username: 'alice',
          prizeId: 'prize-1',
          prizeName: '一等奖',
          dollars: 10,
          rewardStatus: 'pending' as const,
        },
      ],
    };

    mockKvSet
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce('OK');
    mockKvGet
      .mockResolvedValueOnce(raffleBeforeDraw)
      .mockResolvedValueOnce(endedRaffleForDelivery);
    mockKvLrange.mockResolvedValue([
      {
        id: 'entry-1',
        raffleId: 'raffle-3',
        userId: 1001,
        username: 'alice',
        entryNumber: 1,
        createdAt: 1,
      },
    ]);
    mockKvSrem.mockResolvedValue(1);
    mockKvLpush.mockRejectedValue(new Error('log write failed'));
    mockKvEval.mockResolvedValue(1);
    mockCreditQuotaToUser.mockResolvedValue({
      success: true,
      message: '充值成功',
    });

    const result = await executeRaffleDraw('raffle-3');

    expect(result.success).toBe(true);
    expect(result.deliveryResults?.[0]).toMatchObject({
      userId: 1001,
      success: true,
    });

    const finalRaffle = mockKvSet.mock.calls[2][1] as {
      winners?: Array<{ rewardStatus: string }>;
    };
    expect(finalRaffle.winners?.[0]?.rewardStatus).toBe('delivered');
  });

  it('returns quickly in auto-draw mode without waiting reward delivery', async () => {
    const raffleBeforeDraw = {
      id: 'raffle-4',
      title: '自动开奖活动',
      description: 'desc',
      prizes: [
        { id: 'prize-1', name: '一等奖', dollars: 10, quantity: 1 },
      ],
      triggerType: 'threshold' as const,
      threshold: 1,
      status: 'active' as const,
      participantsCount: 1,
      winnersCount: 0,
      createdBy: 1,
      createdAt: 1,
      updatedAt: 1,
    };

    const endedRaffleForDelivery = {
      ...raffleBeforeDraw,
      status: 'ended' as const,
      winnersCount: 1,
      winners: [
        {
          entryId: 'entry-1',
          userId: 1001,
          username: 'alice',
          prizeId: 'prize-1',
          prizeName: '一等奖',
          dollars: 10,
          rewardStatus: 'pending' as const,
        },
      ],
    };

    mockKvSet
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce('OK');
    mockKvGet
      .mockResolvedValueOnce(raffleBeforeDraw)
      .mockResolvedValueOnce(endedRaffleForDelivery);
    mockKvLrange.mockResolvedValue([
      {
        id: 'entry-1',
        raffleId: 'raffle-4',
        userId: 1001,
        username: 'alice',
        entryNumber: 1,
        createdAt: 1,
      },
    ]);
    mockKvSrem.mockResolvedValue(1);
    mockKvEval.mockResolvedValue(1);
    mockCreditQuotaToUser.mockImplementation(
      () => new Promise(() => {
        // keep pending to verify executeRaffleDraw doesn't await delivery in auto mode
      })
    );

    const drawPromise = executeRaffleDraw('raffle-4', { waitForDelivery: false });
    const timedResult = await Promise.race([
      drawPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('auto draw timed out')), 50)
      ),
    ]);

    expect(timedResult).toMatchObject({ success: true });
    expect(mockCreditQuotaToUser).toHaveBeenCalledTimes(1);
  });
});
