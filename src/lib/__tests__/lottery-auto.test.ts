import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';
import { spinLotteryAuto } from '../lottery';
import { tryUseExtraSpin, tryClaimDailyFree, rollbackExtraSpin, releaseDailyFree } from '../kv';
import { creditQuotaToUser } from '../new-api';

vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    scard: vi.fn(),
    eval: vi.fn(),
    lpush: vi.fn(),
    decrby: vi.fn(),
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
  const mockKvScard = vi.mocked(kv.scard);
  const mockKvEval = vi.mocked(kv.eval);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockKvDecrby = vi.mocked(kv.decrby);

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
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    mockTryUseExtraSpin.mockResolvedValue({ success: true } as { success: boolean });
    mockTryClaimDailyFree.mockResolvedValue(false);
    mockRollbackExtraSpin.mockResolvedValue({ success: true } as { success: boolean });
    mockReleaseDailyFree.mockResolvedValue({ success: true } as { success: boolean });

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

    mockKvLpush.mockResolvedValue(1);
    mockKvDecrby.mockResolvedValue(0);
  });

  it('does not downgrade to code mode when direct result is uncertain', async () => {
    mockKvEval.mockResolvedValue([1, 100] as [number, number]); // reserveDailyDirectQuota
    mockCreditQuotaToUser.mockResolvedValue({
      success: false,
      message: '充值结果不确定',
      uncertain: true,
    } as { success: boolean; message: string; uncertain?: boolean; newQuota?: number });

    const result = await spinLotteryAuto(1001, 'alice');

    expect(result.success).toBe(false);
    expect((result as { uncertain?: boolean }).uncertain).toBe(true);
    expect(mockKvEval).toHaveBeenCalledTimes(1);
    expect(mockRollbackExtraSpin).not.toHaveBeenCalled();
    expect(mockKvLpush).toHaveBeenCalledTimes(2);
  });

  it('downgrades to code mode when direct fails explicitly and keeps single spin consumption', async () => {
    mockKvEval
      .mockResolvedValueOnce([1, 100] as [number, number]) // reserveDailyDirectQuota in direct
      .mockResolvedValueOnce([1, 'CODE-OK', 'ok'] as [number, string, string]); // code mode atomic claim

    mockCreditQuotaToUser.mockResolvedValue({
      success: false,
      message: '额度更新失败',
    } as { success: boolean; message: string; uncertain?: boolean; newQuota?: number });

    const result = await spinLotteryAuto(1002, 'bob');

    expect(result.success).toBe(true);
    expect(result.record?.code).toBe('CODE-OK');
    expect(mockTryUseExtraSpin).toHaveBeenCalledTimes(1);
    expect(mockRollbackExtraSpin).not.toHaveBeenCalled();
    expect(mockKvDecrby).toHaveBeenCalledTimes(1); // direct 失败后回滚预占额度
    expect(mockKvEval).toHaveBeenCalledTimes(2);
  });

  it('rolls back consumed spin when direct is unavailable and code fallback also fails', async () => {
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'lottery:config') {
        return {
          ...hybridConfig,
          dailyDirectLimit: 1,
        };
      }
      if (key.startsWith('lottery:daily_direct:')) {
        return 100; // $1.00 已用满，checkDailyDirectLimit(1) => false
      }
      return null;
    });

    mockKvScard.mockImplementation(async (key: string) => {
      if (String(key).startsWith('lottery:codes:')) {
        return 0; // 无库存，code fallback 失败
      }
      if (String(key).startsWith('lottery:used:')) {
        return 0;
      }
      return 0;
    });

    const result = await spinLotteryAuto(1003, 'carol');

    expect(result.success).toBe(false);
    expect(result.message).toContain('库存不足');
    expect(mockRollbackExtraSpin).toHaveBeenCalledTimes(1);
    expect(mockKvEval).not.toHaveBeenCalled();
  });
});
