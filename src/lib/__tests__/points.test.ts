import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';

vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(),
    incrby: vi.fn(),
    eval: vi.fn(),
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
const mockEval = vi.mocked(kv.eval);
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
    // Lua returns [pointsEarned, balance, dailyEarned, limitReached]
    mockEval.mockResolvedValue([10, 110, 10, 0]);
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
    expect(mockEval).toHaveBeenCalledTimes(1);
    expect(mockLpush).toHaveBeenCalledWith('points_log:1', expect.objectContaining({
      amount: 10,
      source: 'game_play',
    }));
    expect(mockLtrim).toHaveBeenCalledTimes(1);
  });

  it('returns 0 earned when daily limit already reached', async () => {
    // grant=0, balance stays, dailyEarned at limit, limitReached=1
    mockEval.mockResolvedValue([0, 100, 100, 1]);

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
    // Only 5 remaining out of 100 limit, score is 10 => grant=5
    mockEval.mockResolvedValue([5, 105, 100, 1]);
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
    expect(mockEval).not.toHaveBeenCalled();
    expect(mockLpush).not.toHaveBeenCalled();
  });

  it('throws when score is negative', async () => {
    await expect(
      addGamePointsWithLimit(1, -1, 100, 'game_play', 'test')
    ).rejects.toThrow('Score must be non-negative');
    expect(mockEval).not.toHaveBeenCalled();
  });
});

// ---------- deductPoints ----------
describe('deductPoints', () => {
  it('deducts points and returns new balance', async () => {
    mockEval.mockResolvedValue([1, 50]);
    mockLpush.mockResolvedValue(1);
    mockLtrim.mockResolvedValue('OK' as any);

    const result = await deductPoints(1, 50, 'exchange', 'bought item');

    expect(result).toEqual({ success: true, balance: 50 });
    expect(mockEval).toHaveBeenCalledTimes(1);
    expect(mockLpush).toHaveBeenCalledWith('points_log:1', expect.objectContaining({
      amount: -50,
      source: 'exchange',
      description: 'bought item',
      balance: 50,
    }));
    expect(mockLtrim).toHaveBeenCalledTimes(1);
  });

  it('returns failure when balance is insufficient', async () => {
    mockEval.mockResolvedValue([0, 30]);

    const result = await deductPoints(1, 50, 'exchange', 'bought item');

    expect(result).toEqual({
      success: false,
      balance: 30,
      message: '积分不足',
    });
    expect(mockLpush).not.toHaveBeenCalled();
  });

  it('throws when amount <= 0', async () => {
    await expect(deductPoints(1, 0, 'exchange', 'test')).rejects.toThrow('Amount must be positive');
    await expect(deductPoints(1, -10, 'exchange', 'test')).rejects.toThrow('Amount must be positive');
    expect(mockEval).not.toHaveBeenCalled();
  });
});

// ---------- applyPointsDelta ----------
describe('applyPointsDelta', () => {
  it('applies positive delta successfully', async () => {
    mockEval.mockResolvedValue([1, 200]);

    const result = await applyPointsDelta(1, 50, 'admin_adjust', 'bonus');

    expect(result).toEqual({ success: true, balance: 200 });
    expect(mockEval).toHaveBeenCalledTimes(1);
  });

  it('applies negative delta when balance is sufficient', async () => {
    mockEval.mockResolvedValue([1, 50]);

    const result = await applyPointsDelta(1, -50, 'admin_adjust', 'penalty');

    expect(result).toEqual({ success: true, balance: 50 });
  });

  it('returns failure when negative delta exceeds balance', async () => {
    mockEval.mockResolvedValue([0, 30]);

    const result = await applyPointsDelta(1, -100, 'admin_adjust', 'penalty');

    expect(result).toEqual({ success: false, balance: 30, message: '积分不足' });
  });

  it('returns current balance immediately when delta is 0', async () => {
    mockGet.mockResolvedValue(300);

    const result = await applyPointsDelta(1, 0, 'admin_adjust', 'no change');

    expect(result).toEqual({ success: true, balance: 300 });
    expect(mockEval).not.toHaveBeenCalled();
  });

  it('throws when description is empty', async () => {
    await expect(applyPointsDelta(1, 10, 'admin_adjust', '')).rejects.toThrow('Description is required');
    await expect(applyPointsDelta(1, 10, 'admin_adjust', '   ')).rejects.toThrow('Description is required');
    expect(mockEval).not.toHaveBeenCalled();
  });

  it('throws when delta is not an integer', async () => {
    await expect(applyPointsDelta(1, 1.5, 'admin_adjust', 'test')).rejects.toThrow('Delta must be an integer');
    await expect(applyPointsDelta(1, NaN, 'admin_adjust', 'test')).rejects.toThrow('Delta must be an integer');
    await expect(applyPointsDelta(1, Infinity, 'admin_adjust', 'test')).rejects.toThrow('Delta must be an integer');
    expect(mockEval).not.toHaveBeenCalled();
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
