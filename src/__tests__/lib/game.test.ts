import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { addGamePointsWithLimit } from '@/lib/points';
import { incrementSharedDailyStats } from '@/lib/daily-stats';
import { submitGameResult } from '@/lib/game';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    lpush: vi.fn(),
    ltrim: vi.fn(),
    ttl: vi.fn(),
    lrange: vi.fn(),
  },
}));

vi.mock('@/lib/points', () => ({
  addGamePointsWithLimit: vi.fn(async (_userId: number, score: number) => ({
    success: true,
    pointsEarned: score,
    dailyEarned: score,
    balance: score,
  })),
}));

vi.mock('@/lib/config', () => ({
  getDailyPointsLimit: vi.fn(async () => 2000),
}));

vi.mock('@/lib/daily-stats', () => ({
  getDailyStats: vi.fn(),
  incrementSharedDailyStats: vi.fn(async (userId: number, scoreDelta: number, cumulativePointsEarned: number, now: number = Date.now()) => ({
    userId,
    date: '2026-03-09',
    gamesPlayed: 1,
    totalScore: scoreDelta,
    pointsEarned: cumulativePointsEarned,
    lastGameAt: now,
  })),
}));

describe('submitGameResult', () => {
  const mockKvSet = vi.mocked(kv.set);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvDel = vi.mocked(kv.del);
  const mockKvIncr = vi.mocked(kv.incr);
  const mockKvExpire = vi.mocked(kv.expire);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockKvLtrim = vi.mocked(kv.ltrim);
  const mockAddGamePointsWithLimit = vi.mocked(addGamePointsWithLimit);
  const mockIncrementSharedDailyStats = vi.mocked(incrementSharedDailyStats);

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvSet.mockResolvedValue('OK');
    mockKvDel.mockResolvedValue(1);
    mockKvIncr.mockResolvedValue(1);
    mockKvExpire.mockResolvedValue(1);
    mockKvLpush.mockResolvedValue(1);
    mockKvLtrim.mockResolvedValue(undefined);
  });

  it('拒绝可疑的重复发射参数提交', async () => {
    const now = Date.now();
    mockKvGet.mockResolvedValueOnce({
      id: 'session-1',
      userId: 1001,
      gameType: 'pachinko',
      seed: 'seed-1',
      startedAt: now - 60_000,
      expiresAt: now + 60_000,
      status: 'playing',
    });

    const result = await submitGameResult(1001, {
      sessionId: 'session-1',
      score: 30,
      duration: 60000,
      balls: [
        { angle: 10.1, power: 0.77, slotScore: 5, duration: 1200 },
        { angle: 10.1, power: 0.77, slotScore: 5, duration: 1200 },
        { angle: 10.1, power: 0.77, slotScore: 5, duration: 1200 },
        { angle: 10.1, power: 0.77, slotScore: 5, duration: 1200 },
        { angle: 10.1, power: 0.77, slotScore: 10, duration: 1200 },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('检测到异常提交行为');
    expect(mockKvIncr).toHaveBeenCalled();
  });

  it('拒绝不可能的弹珠时长', async () => {
    const now = Date.now();
    mockKvGet.mockResolvedValueOnce({
      id: 'session-2',
      userId: 1001,
      gameType: 'pachinko',
      seed: 'seed-2',
      startedAt: now - 60_000,
      expiresAt: now + 60_000,
      status: 'playing',
    });

    const result = await submitGameResult(1001, {
      sessionId: 'session-2',
      score: 30,
      duration: 60000,
      balls: [
        { angle: 0, power: 0.6, slotScore: 5, duration: 100 },
        { angle: 5, power: 0.7, slotScore: 5, duration: 1200 },
        { angle: -3, power: 0.9, slotScore: 5, duration: 1300 },
        { angle: 8, power: 0.8, slotScore: 5, duration: 1400 },
        { angle: -9, power: 0.85, slotScore: 10, duration: 1500 },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('检测到异常提交行为');
    expect(mockKvIncr).toHaveBeenCalled();
  });

  it('成功提交时直接返回余额和当日日统计', async () => {
    const now = Date.now();
    mockKvGet.mockResolvedValueOnce({
      id: 'session-3',
      userId: 1001,
      gameType: 'pachinko',
      seed: 'seed-3',
      startedAt: now - 60_000,
      expiresAt: now + 60_000,
      status: 'playing',
    });
    mockAddGamePointsWithLimit.mockResolvedValueOnce({
      success: true,
      pointsEarned: 30,
      dailyEarned: 80,
      balance: 120,
      limitReached: false,
    });
    mockIncrementSharedDailyStats.mockResolvedValueOnce({
      userId: 1001,
      date: '2026-03-09',
      gamesPlayed: 3,
      totalScore: 150,
      pointsEarned: 80,
      lastGameAt: now,
    });

    const result = await submitGameResult(1001, {
      sessionId: 'session-3',
      score: 30,
      duration: 60000,
      balls: [
        { angle: 0, power: 0.65, slotScore: 5, duration: 1200 },
        { angle: 5, power: 0.7, slotScore: 5, duration: 1300 },
        { angle: -3, power: 0.75, slotScore: 5, duration: 1400 },
        { angle: 8, power: 0.8, slotScore: 5, duration: 1500 },
        { angle: -9, power: 0.85, slotScore: 10, duration: 1600 },
      ],
    });

    expect(result).toMatchObject({
      success: true,
      pointsEarned: 30,
      balance: 120,
      dailyStats: {
        gamesPlayed: 3,
        pointsEarned: 80,
      },
    });
    expect(mockAddGamePointsWithLimit).toHaveBeenCalledWith(
      1001,
      30,
      2000,
      'game_play',
      '弹珠游戏得分 30'
    );
    expect(mockIncrementSharedDailyStats).toHaveBeenCalledWith(1001, 30, 80);
    expect(mockKvLpush).toHaveBeenCalledTimes(1);
    expect(mockKvLtrim).toHaveBeenCalledWith('game:records:1001', 0, 49);
  });
});
