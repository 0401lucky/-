import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { nanoid } from 'nanoid';
import { creditQuotaToUser } from '../new-api';
import { executeRaffleDraw, joinRaffle, retryFailedRewards } from '../raffle';
import { getTodayDirectTotal, reserveDailyDirectQuota, rollbackDailyDirectQuota } from '../lottery';
import { getTodayDateString } from '../time';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    set: vi.fn(),
    get: vi.fn(),
    lrange: vi.fn(),
    srem: vi.fn(),
    lpush: vi.fn(),
    rpop: vi.fn(),
    del: vi.fn(),
    decrby: vi.fn(),
    incrby: vi.fn(),
    ttl: vi.fn(),
    expire: vi.fn(),
    exists: vi.fn(),
    sismember: vi.fn(),
    incr: vi.fn(),
    sadd: vi.fn(),
    lrem: vi.fn(),
  },
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(),
}));

vi.mock('../new-api', () => ({
  creditQuotaToUser: vi.fn(),
}));

vi.mock('../notifications', () => ({
  createUserNotification: vi.fn(),
}));

vi.mock('../time', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../time')>();
  return {
    ...mod,
    getTodayDateString: vi.fn(() => '2026-02-10'),
    getSecondsUntilMidnight: vi.fn(() => 3600),
  };
});

vi.mock('../lottery', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lottery')>();
  return {
    ...mod,
    getLotteryConfig: vi.fn(async () => ({
      enabled: true,
      mode: 'direct' as const,
      dailyDirectLimit: 2000,
      tiers: [],
    })),
  };
});

describe('raffle robustness', () => {
  const mockKvSet = vi.mocked(kv.set);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvLrange = vi.mocked(kv.lrange);
  const mockKvSrem = vi.mocked(kv.srem);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockKvDecrby = vi.mocked(kv.decrby);
  const mockKvDel = vi.mocked(kv.del);
  const mockKvExists = vi.mocked(kv.exists);
  const mockKvSismember = vi.mocked(kv.sismember);
  const mockKvIncr = vi.mocked(kv.incr);
  const mockKvSadd = vi.mocked(kv.sadd);
  const mockKvIncrby = vi.mocked(kv.incrby);
  const mockKvTtl = vi.mocked(kv.ttl);
  const mockKvExpire = vi.mocked(kv.expire);
  const mockKvLrem = vi.mocked(kv.lrem);
  const mockGetTodayDateString = vi.mocked(getTodayDateString);
  const mockNanoid = vi.mocked(nanoid);
  const mockCreditQuotaToUser = vi.mocked(creditQuotaToUser);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockNanoid.mockReturnValue('mock-token');
    mockGetTodayDateString.mockReturnValue('2026-02-10');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks join when draw lock exists', async () => {
    // D1-compatible joinRaffle: kv.get reads raffle, kv.exists checks draw lock
    const raffle = {
      id: 'raffle-1',
      title: 'Test',
      status: 'active',
      prizes: [],
      participantsCount: 0,
    };
    mockKvGet.mockResolvedValueOnce(raffle); // read raffle
    mockKvExists.mockResolvedValueOnce(1); // draw lock exists

    const result = await joinRaffle('raffle-1', 1001, 'alice');

    expect(result).toEqual({ success: false, message: '活动正在开奖，请稍后再试' });
    expect(mockKvExists).toHaveBeenCalledWith('raffle:draw_lock:raffle-1');
  });

  it('always releases draw lock when retry read fails', async () => {
    // acquireDrawLock: kv.set returns 'OK'
    mockKvSet.mockResolvedValue('OK');
    // getRaffle: kv.get throws
    mockKvGet.mockRejectedValueOnce(new Error('kv get failed'));
    // releaseDrawLock: kv.get returns the token, kv.del deletes it
    mockKvGet.mockResolvedValueOnce('mock-token');
    mockKvDel.mockResolvedValue(1);

    await expect(retryFailedRewards('raffle-2')).rejects.toThrow('kv get failed');
    // Verify releaseDrawLock was called: kv.get for lock key, then kv.del
    expect(mockKvGet).toHaveBeenCalledWith('raffle:draw_lock:raffle-2');
    expect(mockKvDel).toHaveBeenCalledWith('raffle:draw_lock:raffle-2');
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

    // acquireDrawLock: kv.set returns 'OK'
    mockKvSet.mockResolvedValue('OK');
    mockKvGet
      .mockResolvedValueOnce(raffleBeforeDraw) // executeRaffleDraw: getRaffle
      .mockResolvedValueOnce(endedRaffleForDelivery) // deliverRewards: getRaffle
      .mockResolvedValueOnce(null) // getDeliveryIdempotencyState: returns null (no previous state)
      .mockResolvedValueOnce(null) // getDeliveryIdempotencyState: finally block check
      .mockResolvedValueOnce('mock-token'); // releaseDrawLock: kv.get for lock token
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
    mockKvDel.mockResolvedValue(1);
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

    const finalRaffleCall = [...mockKvSet.mock.calls]
      .reverse()
      .find(([key]) => key === 'raffle:raffle-3');
    const finalRaffle = finalRaffleCall?.[1] as {
      winners?: Array<{ rewardStatus: string }>;
    } | undefined;
    expect(finalRaffle?.winners?.[0]?.rewardStatus).toBe('delivered');
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

    mockKvSet.mockResolvedValue('OK');
    mockKvGet
      .mockResolvedValueOnce(raffleBeforeDraw) // executeRaffleDraw: getRaffle
      .mockResolvedValueOnce('mock-token'); // releaseDrawLock: kv.get for lock token
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
    mockKvLpush.mockResolvedValue(1);
    mockKvDel.mockResolvedValue(1);
    mockCreditQuotaToUser.mockResolvedValue({ success: true, message: '充值成功' });

    const drawPromise = executeRaffleDraw('raffle-4', { waitForDelivery: false });
    const timedResult = await Promise.race([
      drawPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('auto draw timed out')), 50)
      ),
    ]);

    expect(timedResult).toMatchObject({ success: true });
    expect(mockCreditQuotaToUser).toHaveBeenCalledTimes(0);
    expect(mockKvLpush).toHaveBeenCalledWith(
      'raffle:delivery:queue',
      expect.stringContaining('"raffleId":"raffle-4"')
    );
  });

  it('retries stale pending rewards in retry flow', async () => {
    const raffleWithStalePending = {
      id: 'raffle-5',
      title: '待确认重试活动',
      description: 'desc',
      prizes: [
        { id: 'prize-1', name: '一等奖', dollars: 10, quantity: 1 },
      ],
      triggerType: 'manual' as const,
      threshold: 1,
      status: 'ended' as const,
      participantsCount: 1,
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
          rewardAttempts: 1,
          rewardAttemptedAt: Date.now() - 11 * 60 * 1000,
        },
      ],
      createdBy: 1,
      createdAt: 1,
      updatedAt: 1,
      drawnAt: Date.now() - 11 * 60 * 1000,
    };

    mockKvSet.mockResolvedValue('OK');
    mockKvGet
      .mockResolvedValueOnce(raffleWithStalePending) // retryFailedRewards: getRaffle
      .mockResolvedValueOnce(raffleWithStalePending) // deliverRewards: getRaffle
      .mockResolvedValueOnce(null) // getDeliveryIdempotencyState: no previous state
      .mockResolvedValueOnce(null) // getDeliveryIdempotencyState: finally block
      .mockResolvedValueOnce('mock-token'); // releaseDrawLock: kv.get for lock token
    mockKvDel.mockResolvedValue(1);
    mockKvLpush.mockResolvedValue(1);
    mockCreditQuotaToUser.mockResolvedValue({
      success: true,
      message: '充值成功',
    });

    const result = await retryFailedRewards('raffle-5');

    expect(result.success).toBe(true);
    expect(result.message).toContain('超时待确认 1 笔');
    expect(mockCreditQuotaToUser).toHaveBeenCalledTimes(1);

    const finalRaffleCall = [...mockKvSet.mock.calls]
      .reverse()
      .find(([key]) => key === 'raffle:raffle-5');
    const finalRaffle = finalRaffleCall?.[1] as {
      winners?: Array<{ rewardStatus: string }>;
    } | undefined;
    expect(finalRaffle?.winners?.[0]?.rewardStatus).toBe('delivered');
  });

  it('stores direct total in cents and supports decimals', async () => {
    mockKvGet.mockResolvedValue(12345);

    const total = await getTodayDirectTotal();
    expect(total).toBe(123.45);
  });

  it('reserves fractional daily direct quota via D1-compatible increment', async () => {
    // D1-compatible: kv.incrby increments cents, kv.ttl checks expiry, kv.expire sets TTL
    mockKvIncrby.mockResolvedValue(123); // new total in cents
    mockKvTtl.mockResolvedValue(-1); // no existing expiry
    mockKvExpire.mockResolvedValue(1);

    const result = await reserveDailyDirectQuota(1.23);

    expect(result).toEqual({ success: true, newTotal: 1.23 });
    expect(mockKvIncrby).toHaveBeenCalledWith(
      'lottery:daily_direct:2026-02-10',
      123
    );
    expect(mockKvTtl).toHaveBeenCalledWith('lottery:daily_direct:2026-02-10');
    expect(mockKvExpire).toHaveBeenCalledWith(
      'lottery:daily_direct:2026-02-10',
      expect.any(Number)
    );
  });

  it('rolls back fractional direct quota with scaled decrby', async () => {
    mockKvDecrby.mockResolvedValue(0);

    await rollbackDailyDirectQuota(2.75);

    expect(mockKvDecrby).toHaveBeenCalledWith('lottery:daily_direct:2026-02-10', 275);
  });
});
