import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    incrby: vi.fn(),
    decrby: vi.fn(),
    expire: vi.fn(),
    lpush: vi.fn(),
    ltrim: vi.fn(),
    lrange: vi.fn(),
  },
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-id'),
}));

vi.mock('../time', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../time')>();
  return {
    ...mod,
    getTodayDateString: vi.fn(() => '2026-02-19'),
  };
});

import {
  getUserPoints,
  addPoints,
  addGamePointsWithLimit,
  deductPoints,
  applyPointsDelta,
  getPointsLogs,
} from '../points';

const mockGet = vi.mocked(kv.get);
const mockIncrby = vi.mocked(kv.incrby);
const mockDecrby = vi.mocked(kv.decrby);
const mockExpire = vi.mocked(kv.expire);
const mockLpush = vi.mocked(kv.lpush);
const mockLtrim = vi.mocked(kv.ltrim);
const mockLrange = vi.mocked(kv.lrange);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
});

// ---------- getUserPoints ----------
describe('getUserPoints', () => {
  it('returns 0 when user does not exist', async () => {
    mockGet.mockResolvedValue(null);
    expect(await getUserPoints(1)).toBe(0);
    expect(mockGet).toHaveBeenCalledWith('points:1');
  });

  it('returns the stored balance', async () => {
    mockGet.mockResolvedValue(500);
    expect(await getUserPoints(2)).toBe(500);
  });
});

// ---------- addPoints ----------
describe('addPoints', () => {
  it('adds points and returns new balance', async () => {
    mockIncrby.mockResolvedValue(150);
    mockLpush.mockResolvedValue(1);
    mockLtrim.mockResolvedValue('OK' as any);

    const result = await addPoints(1, 150, 'game_win', 'won a game');

    expect(result).toEqual({ success: true, balance: 150 });
    expect(mockIncrby).toHaveBeenCalledWith('points:1', 150);
    expect(mockLpush).toHaveBeenCalledWith('points_log:1', expect.objectContaining({
      id: 'mock-id',
      amount: 150,
      source: 'game_win',
      description: 'won a game',
      balance: 150,
    }));
    expect(mockLtrim).toHaveBeenCalledWith('points_log:1', 0, 99);
  });

  it('throws when amount <= 0', async () => {
    await expect(addPoints(1, 0, 'game_win', 'test')).rejects.toThrow('Amount must be positive');
    await expect(addPoints(1, -5, 'game_win', 'test')).rejects.toThrow('Amount must be positive');
    expect(mockIncrby).not.toHaveBeenCalled();
  });
});

// ---------- addGamePointsWithLimit ----------
describe('addGamePointsWithLimit', () => {
  it('grants full score when under daily limit', async () => {
    // D1-compatible: kv.get returns current daily earned (0), then incrby for points & daily earned
    mockGet.mockResolvedValueOnce(0); // dailyEarned = 0
    mockIncrby
      .mockResolvedValueOnce(110) // points balance after incrby
      .mockResolvedValueOnce(10); // dailyEarned after incrby
    mockExpire.mockResolvedValue(1);
    mockLpush.mockResolvedValue(1);
    mockLtrim.mockResolvedValue('OK' as any);

    const result = await addGamePointsWithLimit(1, 10, 100, 'game_play', 'played');

    expect(result).toEqual({
      success: true,
      pointsEarned: 10,
      balance: 110,
      dailyEarned: 10,
      limitReached: false,
    });
    expect(mockIncrby).toHaveBeenCalledTimes(2);
    expect(mockLpush).toHaveBeenCalledWith('points_log:1', expect.objectContaining({
      amount: 10,
      source: 'game_play',
    }));
    expect(mockLtrim).toHaveBeenCalledTimes(1);
  });

  it('returns 0 earned when daily limit already reached', async () => {
    // D1-compatible: kv.get returns dailyEarned = 100 (at limit), remaining=0, grant=0
    mockGet
      .mockResolvedValueOnce(100) // dailyEarned = 100 (already at limit)
      .mockResolvedValueOnce(100); // points balance (no change, just read)

    const result = await addGamePointsWithLimit(1, 10, 100, 'game_play', 'played');

    expect(result).toEqual({
      success: true,
      pointsEarned: 0,
      balance: 100,
      dailyEarned: 100,
      limitReached: true,
    });
    // no log when pointsEarned = 0
    expect(mockLpush).not.toHaveBeenCalled();
  });

  it('truncates score when remaining daily allowance is less than score', async () => {
    // D1-compatible: dailyEarned=95, limit=100, score=10 => grant=5
    mockGet.mockResolvedValueOnce(95); // dailyEarned = 95
    mockIncrby
      .mockResolvedValueOnce(105) // points balance after +5
      .mockResolvedValueOnce(100); // dailyEarned after +5 = 100
    mockExpire.mockResolvedValue(1);
    mockLpush.mockResolvedValue(1);
    mockLtrim.mockResolvedValue('OK' as any);

    const result = await addGamePointsWithLimit(1, 10, 100, 'game_play', 'played');

    expect(result.pointsEarned).toBe(5);
    expect(result.limitReached).toBe(true);
    expect(mockLpush).toHaveBeenCalledWith('points_log:1', expect.objectContaining({
      amount: 5,
    }));
  });

  it('returns current state immediately when score is 0', async () => {
    mockGet.mockResolvedValueOnce(200); // getUserPoints
    mockGet.mockResolvedValueOnce(30);  // getDailyEarnedPoints

    const result = await addGamePointsWithLimit(1, 0, 100, 'game_play', 'played');

    expect(result).toEqual({
      success: true,
      pointsEarned: 0,
      balance: 200,
      dailyEarned: 30,
      limitReached: false,
    });
    expect(mockIncrby).not.toHaveBeenCalled();
    expect(mockLpush).not.toHaveBeenCalled();
  });

  it('throws when score is negative', async () => {
    await expect(
      addGamePointsWithLimit(1, -1, 100, 'game_play', 'test')
    ).rejects.toThrow('Score must be non-negative');
    expect(mockIncrby).not.toHaveBeenCalled();
  });
});

// ---------- deductPoints ----------
describe('deductPoints', () => {
  it('deducts points and returns new balance', async () => {
    // D1-compatible: kv.get returns current balance, kv.decrby deducts
    mockGet.mockResolvedValueOnce(100); // current balance = 100
    mockDecrby.mockResolvedValue(50); // new balance after deducting 50
    mockLpush.mockResolvedValue(1);
    mockLtrim.mockResolvedValue('OK' as any);

    const result = await deductPoints(1, 50, 'exchange', 'bought item');

    expect(result).toEqual({ success: true, balance: 50 });
    expect(mockGet).toHaveBeenCalledWith('points:1');
    expect(mockDecrby).toHaveBeenCalledWith('points:1', 50);
    expect(mockLpush).toHaveBeenCalledWith('points_log:1', expect.objectContaining({
      amount: -50,
      source: 'exchange',
      description: 'bought item',
      balance: 50,
    }));
    expect(mockLtrim).toHaveBeenCalledTimes(1);
  });

  it('returns failure when balance is insufficient', async () => {
    // D1-compatible: kv.get returns current balance < amount
    mockGet.mockResolvedValueOnce(30); // current balance = 30, less than 50

    const result = await deductPoints(1, 50, 'exchange', 'bought item');

    expect(result).toEqual({
      success: false,
      balance: 30,
      message: '积分不足',
    });
    expect(mockLpush).not.toHaveBeenCalled();
    expect(mockDecrby).not.toHaveBeenCalled();
  });

  it('throws when amount <= 0', async () => {
    await expect(deductPoints(1, 0, 'exchange', 'test')).rejects.toThrow('Amount must be positive');
    await expect(deductPoints(1, -10, 'exchange', 'test')).rejects.toThrow('Amount must be positive');
    expect(mockGet).not.toHaveBeenCalled();
  });
});

// ---------- applyPointsDelta ----------
describe('applyPointsDelta', () => {
  it('applies positive delta successfully', async () => {
    // D1-compatible: kv.get returns current balance, kv.incrby adds delta
    mockGet.mockResolvedValueOnce(150); // current balance
    mockIncrby.mockResolvedValue(200); // new balance after +50
    mockLpush.mockResolvedValue(1);
    mockLtrim.mockResolvedValue('OK' as any);

    const result = await applyPointsDelta(1, 50, 'admin_adjust', 'bonus');

    expect(result).toEqual({ success: true, balance: 200 });
    expect(mockIncrby).toHaveBeenCalledWith('points:1', 50);
  });

  it('applies negative delta when balance is sufficient', async () => {
    // D1-compatible: kv.get returns current balance (100), delta=-50 => ok
    mockGet.mockResolvedValueOnce(100); // current balance
    mockIncrby.mockResolvedValue(50); // new balance after -50
    mockLpush.mockResolvedValue(1);
    mockLtrim.mockResolvedValue('OK' as any);

    const result = await applyPointsDelta(1, -50, 'admin_adjust', 'penalty');

    expect(result).toEqual({ success: true, balance: 50 });
  });

  it('returns failure when negative delta exceeds balance', async () => {
    // D1-compatible: kv.get returns current balance (30), delta=-100 => insufficient
    mockGet.mockResolvedValueOnce(30); // current balance = 30

    const result = await applyPointsDelta(1, -100, 'admin_adjust', 'penalty');

    expect(result).toEqual({ success: false, balance: 30, message: '积分不足' });
    expect(mockIncrby).not.toHaveBeenCalled();
  });

  it('returns current balance immediately when delta is 0', async () => {
    mockGet.mockResolvedValue(300);

    const result = await applyPointsDelta(1, 0, 'admin_adjust', 'no change');

    expect(result).toEqual({ success: true, balance: 300 });
    expect(mockIncrby).not.toHaveBeenCalled();
  });

  it('throws when description is empty', async () => {
    await expect(applyPointsDelta(1, 10, 'admin_adjust', '')).rejects.toThrow('Description is required');
    await expect(applyPointsDelta(1, 10, 'admin_adjust', '   ')).rejects.toThrow('Description is required');
    expect(mockIncrby).not.toHaveBeenCalled();
  });

  it('throws when delta is not an integer', async () => {
    await expect(applyPointsDelta(1, 1.5, 'admin_adjust', 'test')).rejects.toThrow('Delta must be an integer');
    await expect(applyPointsDelta(1, NaN, 'admin_adjust', 'test')).rejects.toThrow('Delta must be an integer');
    await expect(applyPointsDelta(1, Infinity, 'admin_adjust', 'test')).rejects.toThrow('Delta must be an integer');
    expect(mockIncrby).not.toHaveBeenCalled();
  });
});

// ---------- getPointsLogs ----------
describe('getPointsLogs', () => {
  it('returns log entries', async () => {
    const logs = [
      { id: 'a', amount: 10, source: 'game_win', description: 'won', balance: 110, createdAt: 1700000000000 },
      { id: 'b', amount: -5, source: 'exchange', description: 'bought', balance: 105, createdAt: 1700000001000 },
    ];
    mockLrange.mockResolvedValue(logs);

    const result = await getPointsLogs(1, 20);

    expect(result).toEqual(logs);
    expect(mockLrange).toHaveBeenCalledWith('points_log:1', 0, 19);
  });

  it('returns empty array when no logs exist', async () => {
    mockLrange.mockResolvedValue(null as any);

    const result = await getPointsLogs(1);

    expect(result).toEqual([]);
  });
});
