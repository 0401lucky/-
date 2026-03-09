import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { spinLotteryAuto, getLotteryDailyRanking } from '../lottery';
import { tryUseExtraSpin, tryClaimDailyFree, rollbackExtraSpin, releaseDailyFree } from '../kv';
import { creditQuotaToUser } from '../new-api';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    scard: vi.fn(),
    smembers: vi.fn(),
    sismember: vi.fn(),
    srandmember: vi.fn(),
    sadd: vi.fn(),
    lpush: vi.fn(),
    hget: vi.fn(),
    hset: vi.fn(),
    hgetall: vi.fn(),
    zrange: vi.fn(),
    hincrby: vi.fn(),
    zcard: vi.fn(),
    zincrby: vi.fn(),
    decrby: vi.fn(),
    incrby: vi.fn(),
    ttl: vi.fn(),
    expire: vi.fn(),
  },
}));

vi.mock('../kv', () => ({
  tryUseExtraSpin: vi.fn(),
  tryClaimDailyFree: vi.fn(),
  rollbackExtraSpin: vi.fn(),
  releaseDailyFree: vi.fn(),
}));

vi.mock('../new-api', () => ({
  creditQuotaToUser: vi.fn(),
}));

vi.mock('../time', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../time')>();
  return {
    ...mod,
    getTodayDateString: vi.fn(() => '2026-02-10'),
    getSecondsUntilMidnight: vi.fn(() => 3600),
  };
});

describe('spinLotteryAuto hybrid mode', () => {
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvScard = vi.mocked(kv.scard);
  const mockKvSmembers = vi.mocked(kv.smembers);
  const mockKvSismember = vi.mocked(kv.sismember);
  const mockKvSrandmember = vi.mocked(kv.srandmember);
  const mockKvSadd = vi.mocked(kv.sadd);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockKvHget = vi.mocked(kv.hget);
  const mockKvHset = vi.mocked(kv.hset);
  const mockKvHgetall = vi.mocked(kv.hgetall);
  const mockKvZrange = vi.mocked(kv.zrange);
  const mockKvHincrby = vi.mocked(kv.hincrby);
  const mockKvZcard = vi.mocked(kv.zcard);
  const mockKvZincrby = vi.mocked(kv.zincrby);
  const mockKvDecrby = vi.mocked(kv.decrby);
  const mockKvIncrby = vi.mocked(kv.incrby);
  const mockKvTtl = vi.mocked(kv.ttl);
  const mockKvExpire = vi.mocked(kv.expire);

  const mockTryUseExtraSpin = vi.mocked(tryUseExtraSpin);
  const mockTryClaimDailyFree = vi.mocked(tryClaimDailyFree);
  const mockRollbackExtraSpin = vi.mocked(rollbackExtraSpin);
  const mockReleaseDailyFree = vi.mocked(releaseDailyFree);

  const mockCreditQuotaToUser = vi.mocked(creditQuotaToUser);

  const hybridConfig = {
    enabled: true,
    mode: 'hybrid' as const,
    dailyDirectLimit: 2000,
    tiers: [
      {
        id: 'tier_1',
        name: '1刀福利',
        value: 1,
        probability: 100,
        color: '#fbbf24',
        codesCount: 10,
        usedCount: 0,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-02-10T12:00:00+08:00').getTime());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    mockTryUseExtraSpin.mockResolvedValue({ success: true, remaining: 0 } as any);
    mockTryClaimDailyFree.mockResolvedValue(false);
    mockRollbackExtraSpin.mockResolvedValue(undefined as any);
    mockReleaseDailyFree.mockResolvedValue(undefined as any);

    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'lottery:config') {
        return hybridConfig;
      }
      if (key.startsWith('lottery:daily_direct:')) {
        return 0;
      }
      return null;
    });

    mockKvScard.mockImplementation(async (key: string) => {
      if (String(key).startsWith('lottery:codes:')) {
        return 10;
      }
      if (String(key).startsWith('lottery:used:')) {
        return 0;
      }
      return 0;
    });

    mockKvSet.mockResolvedValue('OK');
    mockKvLpush.mockResolvedValue(1);
    mockKvHget.mockResolvedValue(null);
    mockKvHset.mockResolvedValue(1);
    mockKvHgetall.mockResolvedValue({});
    mockKvZrange.mockResolvedValue([] as any);
    mockKvHincrby.mockResolvedValue(1);
    mockKvZcard.mockResolvedValue(0);
    mockKvZincrby.mockResolvedValue(1);
    mockKvDecrby.mockResolvedValue(0);

    mockKvSismember.mockResolvedValue(0);
    mockKvSrandmember.mockResolvedValue('CODE-OK');

    // Default mocks for reserveDailyDirectQuota (D1-compatible: incrby + ttl + expire)
    mockKvIncrby.mockResolvedValue(100); // 100 cents = $1.00
    mockKvTtl.mockResolvedValue(-1); // no existing expiry
    mockKvExpire.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not downgrade to code mode when direct result is uncertain', async () => {
    // reserveDailyDirectQuota: incrby returns new total in cents, within limit
    mockKvIncrby.mockResolvedValue(100); // 100 cents = $1.00, under 200000 cents limit
    mockKvTtl.mockResolvedValue(-1);
    mockKvExpire.mockResolvedValue(1);

    mockCreditQuotaToUser.mockResolvedValue({
      success: false,
      message: '充值结果不确定',
      uncertain: true,
    } as { success: boolean; message: string; uncertain?: boolean; newQuota?: number });

    const result = await spinLotteryAuto(1001, 'alice');

    expect(result.success).toBe(false);
    expect((result as { uncertain?: boolean }).uncertain).toBe(true);
    expect(mockKvIncrby).toHaveBeenCalled();
    expect(mockKvZincrby).toHaveBeenCalledWith('lottery:rank:daily:2026-02-10', 1, 'u:1001');
    expect(mockKvHset).toHaveBeenCalledWith(
      'lottery:rank:daily:2026-02-10:user:1001',
      expect.objectContaining({
        userId: '1001',
        username: 'alice',
        bestPrize: '[待确认] 1刀福利',
        bestPrizeValue: 1,
      })
    );
    expect(mockRollbackExtraSpin).not.toHaveBeenCalled();
    expect(mockKvLpush).toHaveBeenCalledTimes(2);
  });

  it('downgrades to code mode when direct fails explicitly and keeps single spin consumption', async () => {
    let directTotalCents = 0;
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'lottery:config') {
        return hybridConfig;
      }
      if (key === 'lottery:daily_direct:2026-02-10') {
        return directTotalCents;
      }
      return null;
    });
    mockKvIncrby.mockImplementation(async (_key: string, amount: number) => {
      directTotalCents += amount;
      return directTotalCents;
    });
    mockKvDecrby.mockImplementation(async (_key: string, amount: number) => {
      directTotalCents = Math.max(0, directTotalCents - amount);
      return directTotalCents;
    });
    mockKvTtl.mockResolvedValue(-1);
    mockKvExpire.mockResolvedValue(1);

    mockCreditQuotaToUser.mockResolvedValue({
      success: false,
      message: '额度更新失败',
    } as { success: boolean; message: string; uncertain?: boolean; newQuota?: number });

    // For code fallback mode: smembers returns available codes, sadd marks code as used
    mockKvSmembers.mockImplementation(async (key: string) => {
      if (String(key).startsWith('lottery:codes:')) return ['CODE-OK', 'CODE-2'];
      if (String(key).startsWith('lottery:used:')) return [];
      return [];
    });
    mockKvSadd.mockResolvedValue(1); // code marked as used successfully

    const result = await spinLotteryAuto(1002, 'bob');

    expect(result.success).toBe(true);
    expect(result.record?.code).toBeTruthy(); // a code was assigned
    expect(mockTryUseExtraSpin).toHaveBeenCalledTimes(1);
    expect(mockKvZincrby).toHaveBeenCalledWith('lottery:rank:daily:2026-02-10', 1, 'u:1002');
    expect(mockKvHset).toHaveBeenCalledWith(
      'lottery:rank:daily:2026-02-10:user:1002',
      expect.objectContaining({
        userId: '1002',
        username: 'bob',
        bestPrize: '1刀福利',
        bestPrizeValue: 1,
      })
    );
    expect(mockRollbackExtraSpin).not.toHaveBeenCalled();
    expect(mockKvDecrby).toHaveBeenCalledWith('lottery:daily_direct:2026-02-10', 100);
  });

  it('reads daily ranking from aggregated keys', async () => {
    mockKvZrange.mockResolvedValue(['u:1002', 5, 'u:1001', 3] as any);
    mockKvZcard.mockResolvedValue(2);
    mockKvHgetall.mockImplementation(async (key: string) => {
      if (key === 'lottery:rank:daily:2026-02-10:user:1002') {
        return { username: 'bob', bestPrize: '5刀福利', count: 2 };
      }
      if (key === 'lottery:rank:daily:2026-02-10:user:1001') {
        return { username: 'alice', bestPrize: '3刀福利', count: 1 };
      }
      return {};
    });

    const result = await getLotteryDailyRanking(10);

    expect(result).toEqual({
      date: '2026-02-10',
      totalParticipants: 2,
      ranking: [
        { rank: 1, userId: '1002', username: 'bob', totalValue: 5, bestPrize: '5刀福利', count: 2 },
        { rank: 2, userId: '1001', username: 'alice', totalValue: 3, bestPrize: '3刀福利', count: 1 },
      ],
    });
    expect(mockKvZrange).toHaveBeenCalledWith('lottery:rank:daily:2026-02-10', 0, 9, {
      rev: true,
      withScores: true,
    });
    expect(mockKvZcard).toHaveBeenCalledWith('lottery:rank:daily:2026-02-10');
  });
});
