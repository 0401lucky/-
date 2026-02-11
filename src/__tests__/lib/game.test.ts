import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';
import { submitGameResult } from '@/lib/game';

vi.mock('@vercel/kv', () => ({
  kv: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    lpush: vi.fn(),
    ltrim: vi.fn(),
  },
}));

vi.mock('@/lib/points', () => ({
  addGamePointsWithLimit: vi.fn(async (_userId: number, score: number) => ({
    success: true,
    pointsEarned: score,
    dailyEarned: score,
  })),
}));

vi.mock('@/lib/config', () => ({
  getDailyPointsLimit: vi.fn(async () => 2000),
}));

describe('pachinko anti-cheat checks', () => {
  const mockKvSet = vi.mocked(kv.set);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvDel = vi.mocked(kv.del);
  const mockKvIncr = vi.mocked(kv.incr);
  const mockKvExpire = vi.mocked(kv.expire);

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvSet.mockResolvedValue('OK');
    mockKvDel.mockResolvedValue(1);
    mockKvIncr.mockResolvedValue(1);
    mockKvExpire.mockResolvedValue(1);
  });

  it('rejects suspicious repeated launch parameters', async () => {
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

  it('rejects impossible ball duration values', async () => {
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
});
