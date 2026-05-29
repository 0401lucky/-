import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- mock 依赖 ----------
vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    sadd: vi.fn(),
    smembers: vi.fn(),
    lpush: vi.fn(),
    ltrim: vi.fn(),
    expire: vi.fn(),
  },
}));

vi.mock('../points', () => ({
  applyPointsDelta: vi.fn(),
  applyPointsDeltaInsideUserEconomyLock: vi.fn(),
  getUserPoints: vi.fn(),
}));

vi.mock('../economy-lock', () => ({
  withKvLock: vi.fn(async (_key: string, handler: () => Promise<unknown>) => handler()),
  withUserEconomyLock: vi.fn(async (_userId: number, handler: () => Promise<unknown>) => handler()),
}));

vi.mock('../notifications', () => ({
  createUserNotification: vi.fn(async () => undefined),
}));

vi.mock('../time', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../time')>();
  return {
    ...mod,
    getTodayDateString: vi.fn(() => '2026-05-05'),
  };
});

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-id'),
}));

// 在 mock 完成后再导入被测模块
import { kv } from '@/lib/d1-kv';
import { applyPointsDeltaInsideUserEconomyLock, getUserPoints } from '../points';
import { createUserNotification } from '../notifications';
import {
  cancelNumberBombBet,
  getNumberBombState,
  getPreviousDateString,
  placeNumberBombBet,
  previewNumberBombSystemNumber,
  settleNumberBombDate,
  type NumberBombBet,
} from '../number-bomb';

const mockKvGet = vi.mocked(kv.get);
const mockKvSet = vi.mocked(kv.set);
const mockKvSadd = vi.mocked(kv.sadd);
const mockKvSmembers = vi.mocked(kv.smembers);
const mockKvLpush = vi.mocked(kv.lpush);
const mockKvExpire = vi.mocked(kv.expire);

const mockApplyPoints = vi.mocked(applyPointsDeltaInsideUserEconomyLock);
const mockGetPoints = vi.mocked(getUserPoints);
const mockCreateUserNotification = vi.mocked(createUserNotification);

const TODAY = '2026-05-05';
const YESTERDAY = '2026-05-04';
const USER = { id: 100, username: 'tester' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-05T08:00:00+08:00').getTime());
  mockKvSet.mockResolvedValue('OK' as never);
  mockKvSadd.mockResolvedValue(1 as never);
  mockKvLpush.mockResolvedValue(1 as never);
  mockKvExpire.mockResolvedValue(1 as never);
  // 默认所有 kv.get 都返回 null（无投注、无系统数字、无结算缓存）
  mockKvGet.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// 工具函数
// ============================================================================
describe('getPreviousDateString', () => {
  it('returns the previous calendar day', () => {
    expect(getPreviousDateString('2026-05-05')).toBe('2026-05-04');
    expect(getPreviousDateString('2026-01-01')).toBe('2025-12-31');
    expect(getPreviousDateString('2026-03-01')).toBe('2026-02-28');
  });
});

describe('previewNumberBombSystemNumber', () => {
  it('defaults to today number, which will be announced tomorrow at midnight', async () => {
    mockKvGet.mockResolvedValueOnce(8);

    const preview = await previewNumberBombSystemNumber();

    expect(preview).toEqual({
      date: TODAY,
      systemNumber: 8,
    });
  });
});

describe('getNumberBombState', () => {
  it('returns yesterday system number even when the user did not participate yesterday', async () => {
    mockGetPoints.mockResolvedValueOnce(1234);
    mockKvGet
      .mockResolvedValueOnce(null) // 今日投注
      .mockResolvedValueOnce(null) // 昨日投注
      .mockResolvedValueOnce(6);   // 昨日数字已公布

    const state = await getNumberBombState(USER.id);

    expect(state.date).toBe(TODAY);
    expect(state.yesterday).toBe(YESTERDAY);
    expect(state.yesterdayBet).toBeNull();
    expect(state.todaySystemNumber).toBeNull();
    expect(state.yesterdaySystemNumber).toBe(6);
  });

  it('does not expose today system number or today bet result fields', async () => {
    const todayBet: NumberBombBet = {
      id: 'today-bet',
      userId: USER.id,
      username: USER.username,
      date: TODAY,
      selectedNumber: 3,
      multiplier: 1,
      ticketCost: 10,
      status: 'pending',
      systemNumber: 8,
      rewardPoints: 20,
      createdAt: 1,
      updatedAt: 1,
    };
    mockGetPoints.mockResolvedValueOnce(1234);
    mockKvGet
      .mockResolvedValueOnce(todayBet)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(6);

    const state = await getNumberBombState(USER.id);

    expect(state.todaySystemNumber).toBeNull();
    expect(state.todayBet).toMatchObject({
      id: 'today-bet',
      selectedNumber: 3,
      status: 'pending',
    });
    expect(state.todayBet?.systemNumber).toBeUndefined();
    expect(state.todayBet?.rewardPoints).toBeUndefined();
  });

  it('generates yesterday system number for display when it has not been stored yet', async () => {
    mockGetPoints.mockResolvedValueOnce(1234);
    mockKvGet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.2);

    const state = await getNumberBombState(USER.id);

    expect(state.yesterdaySystemNumber).toBe(2);
    expect(mockKvSet).toHaveBeenCalledWith(
      `number-bomb:draw:${YESTERDAY}`,
      2,
      expect.any(Object),
    );
  });
});

// ============================================================================
// 下注
// ============================================================================
describe('placeNumberBombBet', () => {
  it('rejects an invalid number', async () => {
    await expect(
      placeNumberBombBet(USER, { selectedNumber: 12, multiplier: 1 }),
    ).rejects.toThrow(/0 到 9/);
  });

  it('rejects an invalid multiplier', async () => {
    await expect(
      placeNumberBombBet(USER, { selectedNumber: 5, multiplier: 3 }),
    ).rejects.toThrow(/倍率/);
  });

  it('places a fresh bet and deducts the ticket cost (multiplier 1)', async () => {
    mockKvGet.mockResolvedValueOnce(null); // 当前无投注
    mockApplyPoints.mockResolvedValueOnce({ success: true, balance: 990 });
    mockGetPoints.mockResolvedValueOnce(990);

    const result = await placeNumberBombBet(USER, { selectedNumber: 7, multiplier: 1 });

    expect(result.success).toBe(true);
    expect(result.bet?.selectedNumber).toBe(7);
    expect(result.bet?.ticketCost).toBe(10);
    expect(result.bet?.status).toBe('pending');
    expect(mockApplyPoints).toHaveBeenCalledWith(
      USER.id,
      -10,
      'number_bomb_bet',
      expect.stringContaining('数字炸弹'),
    );
  });

  it('charges 10 * multiplier when user picks a higher multiplier', async () => {
    mockKvGet.mockResolvedValueOnce(null);
    mockApplyPoints.mockResolvedValueOnce({ success: true, balance: 900 });
    mockGetPoints.mockResolvedValueOnce(900);

    const result = await placeNumberBombBet(USER, { selectedNumber: 3, multiplier: 10 });

    expect(result.success).toBe(true);
    expect(result.bet?.ticketCost).toBe(100);
    expect(mockApplyPoints).toHaveBeenCalledWith(USER.id, -100, 'number_bomb_bet', expect.any(String));
  });

  it('returns failure and balance when points are insufficient', async () => {
    mockKvGet.mockResolvedValueOnce(null);
    mockApplyPoints.mockResolvedValueOnce({ success: false, balance: 5, message: '积分不足' });

    const result = await placeNumberBombBet(USER, { selectedNumber: 0, multiplier: 1 });

    expect(result.success).toBe(false);
    expect(result.balance).toBe(5);
    expect(result.message).toContain('积分不足');
  });

  it('charges only the difference when raising the multiplier on an existing pending bet', async () => {
    const existing: NumberBombBet = {
      id: 'b1',
      userId: USER.id,
      username: USER.username,
      date: TODAY,
      selectedNumber: 5,
      multiplier: 1,
      ticketCost: 10,
      status: 'pending',
      createdAt: 1,
      updatedAt: 1,
    };
    mockKvGet.mockResolvedValueOnce(existing);
    mockApplyPoints.mockResolvedValueOnce({ success: true, balance: 960 });
    mockGetPoints.mockResolvedValueOnce(960);

    const result = await placeNumberBombBet(USER, { selectedNumber: 5, multiplier: 5 });

    expect(result.success).toBe(true);
    expect(result.bet?.multiplier).toBe(5);
    expect(result.bet?.ticketCost).toBe(50);
    // delta = previous(10) - new(50) = -40 → 扣 40
    expect(mockApplyPoints).toHaveBeenCalledWith(USER.id, -40, 'number_bomb_bet', expect.any(String));
  });

  it('refunds the difference when lowering the multiplier on an existing pending bet', async () => {
    const existing: NumberBombBet = {
      id: 'b1',
      userId: USER.id,
      username: USER.username,
      date: TODAY,
      selectedNumber: 5,
      multiplier: 10,
      ticketCost: 100,
      status: 'pending',
      createdAt: 1,
      updatedAt: 1,
    };
    mockKvGet.mockResolvedValueOnce(existing);
    mockApplyPoints.mockResolvedValueOnce({ success: true, balance: 1080 });
    mockGetPoints.mockResolvedValueOnce(1080);

    const result = await placeNumberBombBet(USER, { selectedNumber: 5, multiplier: 2 });

    expect(result.success).toBe(true);
    expect(result.bet?.ticketCost).toBe(20);
    // delta = 100 - 20 = 80（退还）
    expect(mockApplyPoints).toHaveBeenCalledWith(USER.id, 80, 'number_bomb_refund', expect.any(String));
  });

  it('rejects re-betting after the user has cancelled today', async () => {
    const cancelled: NumberBombBet = {
      id: 'b1',
      userId: USER.id,
      username: USER.username,
      date: TODAY,
      selectedNumber: 4,
      multiplier: 1,
      ticketCost: 10,
      status: 'cancelled',
      createdAt: 1,
      updatedAt: 1,
    };
    mockKvGet.mockResolvedValueOnce(cancelled);

    const result = await placeNumberBombBet(USER, { selectedNumber: 8, multiplier: 1 });
    expect(result.success).toBe(false);
    expect(result.message).toContain('已取消');
  });

  it('rejects re-betting after the bet has been settled', async () => {
    const settled: NumberBombBet = {
      id: 'b1',
      userId: USER.id,
      username: USER.username,
      date: TODAY,
      selectedNumber: 4,
      multiplier: 1,
      ticketCost: 10,
      status: 'won',
      systemNumber: 9,
      rewardPoints: 20,
      createdAt: 1,
      updatedAt: 1,
    };
    mockKvGet.mockResolvedValueOnce(settled);

    const result = await placeNumberBombBet(USER, { selectedNumber: 1, multiplier: 1 });
    expect(result.success).toBe(false);
    expect(result.message).toContain('已结算');
  });
});

// ============================================================================
// 取消
// ============================================================================
describe('cancelNumberBombBet', () => {
  it('refunds the full ticket cost on cancel', async () => {
    const existing: NumberBombBet = {
      id: 'b1',
      userId: USER.id,
      username: USER.username,
      date: TODAY,
      selectedNumber: 6,
      multiplier: 5,
      ticketCost: 50,
      status: 'pending',
      createdAt: 1,
      updatedAt: 1,
    };
    mockKvGet.mockResolvedValueOnce(existing);
    mockApplyPoints.mockResolvedValueOnce({ success: true, balance: 1050 });

    const result = await cancelNumberBombBet(USER.id);
    expect(result.success).toBe(true);
    expect(result.bet?.status).toBe('cancelled');
    expect(mockApplyPoints).toHaveBeenCalledWith(
      USER.id,
      50,
      'number_bomb_refund',
      expect.stringContaining('取消投注退还'),
    );
  });

  it('rejects when there is no bet today', async () => {
    mockKvGet.mockResolvedValueOnce(null);
    const result = await cancelNumberBombBet(USER.id);
    expect(result.success).toBe(false);
    expect(result.message).toContain('还没有投注');
  });

  it('rejects when current bet is not pending', async () => {
    const settled: NumberBombBet = {
      id: 'b1',
      userId: USER.id,
      username: USER.username,
      date: TODAY,
      selectedNumber: 6,
      multiplier: 1,
      ticketCost: 10,
      status: 'won',
      createdAt: 1,
      updatedAt: 1,
    };
    mockKvGet.mockResolvedValueOnce(settled);
    const result = await cancelNumberBombBet(USER.id);
    expect(result.success).toBe(false);
    expect(result.message).toContain('不能取消');
  });
});

// ============================================================================
// 结算
// ============================================================================
describe('settleNumberBombDate', () => {
  it('returns cached settlement on idempotent retry', async () => {
    const cached = { date: YESTERDAY, systemNumber: 3, processed: 1, won: 1, lost: 0, skipped: 0 };
    mockKvGet.mockResolvedValueOnce(cached); // SETTLEMENT_KEY

    const result = await settleNumberBombDate(YESTERDAY);
    expect(result).toEqual(cached);
    // 不应再调用 ensureSystemNumber 之后的逻辑
    expect(mockKvSadd).not.toHaveBeenCalled();
  });

  it('rewards 2x ticket cost when user number does not match system number', async () => {
    const bet: NumberBombBet = {
      id: 'b1',
      userId: USER.id,
      username: USER.username,
      date: YESTERDAY,
      selectedNumber: 5,
      multiplier: 1,
      ticketCost: 10,
      status: 'pending',
      createdAt: 1,
      updatedAt: 1,
    };
    // 调用顺序：
    // 1) get(SETTLEMENT_KEY) → null
    // 2) get(DRAW_KEY)        → 7（系统数字，与用户 5 不同）
    // 3) get(USER_BET_KEY)    → bet
    mockKvGet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(bet);
    mockKvSmembers.mockResolvedValueOnce([String(USER.id)] as never);
    mockApplyPoints.mockResolvedValueOnce({ success: true, balance: 1020 });
    mockGetPoints.mockResolvedValueOnce(1000);

    const result = await settleNumberBombDate(YESTERDAY);

    expect(result.systemNumber).toBe(7);
    expect(result.won).toBe(1);
    expect(result.lost).toBe(0);
    expect(mockApplyPoints).toHaveBeenCalledWith(
      USER.id,
      20,
      'number_bomb_reward',
      expect.stringContaining('猜中'),
    );
    expect(mockCreateUserNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        type: 'lottery_win',
        title: '数字炸弹开奖通知',
        content: expect.stringContaining('中奖'),
        data: expect.objectContaining({
          game: 'number_bomb',
          betId: bet.id,
          rewardPoints: 20,
          outcome: 'won',
        }),
      }),
    );
  });

  it('does not refund when user number matches system number', async () => {
    const bet: NumberBombBet = {
      id: 'b2',
      userId: USER.id,
      username: USER.username,
      date: YESTERDAY,
      selectedNumber: 4,
      multiplier: 2,
      ticketCost: 20,
      status: 'pending',
      createdAt: 1,
      updatedAt: 1,
    };
    mockKvGet
      .mockResolvedValueOnce(null) // SETTLEMENT_KEY
      .mockResolvedValueOnce(4)     // DRAW_KEY 系统数字
      .mockResolvedValueOnce(bet);  // USER_BET_KEY
    mockKvSmembers.mockResolvedValueOnce([String(USER.id)] as never);
    mockGetPoints.mockResolvedValueOnce(500);

    const result = await settleNumberBombDate(YESTERDAY);
    expect(result.won).toBe(0);
    expect(result.lost).toBe(1);
    // applyPointsDelta 不应被调用
    expect(mockApplyPoints).not.toHaveBeenCalled();
    expect(mockCreateUserNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        type: 'system',
        title: '数字炸弹开奖通知',
        content: expect.stringContaining('未中奖'),
        data: expect.objectContaining({
          game: 'number_bomb',
          betId: bet.id,
          rewardPoints: 0,
          outcome: 'lost',
        }),
      }),
    );
  });

  it('skips bets that are not pending', async () => {
    const cancelled: NumberBombBet = {
      id: 'b3',
      userId: USER.id,
      username: USER.username,
      date: YESTERDAY,
      selectedNumber: 0,
      multiplier: 1,
      ticketCost: 10,
      status: 'cancelled',
      createdAt: 1,
      updatedAt: 1,
    };
    mockKvGet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(cancelled);
    mockKvSmembers.mockResolvedValueOnce([String(USER.id)] as never);

    const result = await settleNumberBombDate(YESTERDAY);
    expect(result.skipped).toBe(1);
    expect(result.won).toBe(0);
    expect(result.lost).toBe(0);
  });

  it('generates a system number when none is stored yet', async () => {
    mockKvGet
      .mockResolvedValueOnce(null) // SETTLEMENT_KEY
      .mockResolvedValueOnce(null); // DRAW_KEY → 触发生成
    mockKvSmembers.mockResolvedValueOnce([] as never);
    vi.spyOn(Math, 'random').mockReturnValue(0.55); // → floor(5.5) = 5

    const result = await settleNumberBombDate(YESTERDAY);
    expect(result.systemNumber).toBe(5);
    // 应当在生成后调用 set 将 DRAW_KEY 写入
    expect(mockKvSet).toHaveBeenCalled();
  });
});
