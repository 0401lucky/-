import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';
import {
  listRankingSettlementHistory,
  settleRankingPeriod,
} from '../ranking-settlement';
import { getAllGamesLeaderboardByRange } from '../rankings';
import { addPoints } from '../points';
import { createUserNotification } from '../notifications';

vi.mock('@vercel/kv', () => ({
  kv: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    zadd: vi.fn(),
    zcard: vi.fn(),
    zrange: vi.fn(),
    mget: vi.fn(),
  },
}));

vi.mock('../rankings', () => ({
  getAllGamesLeaderboardByRange: vi.fn(),
}));

vi.mock('../points', () => ({
  addPoints: vi.fn(),
}));

vi.mock('../notifications', () => ({
  createUserNotification: vi.fn(),
}));

describe('ranking-settlement', () => {
  const mockKvSet = vi.mocked(kv.set);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvDel = vi.mocked(kv.del);
  const mockKvZadd = vi.mocked(kv.zadd);
  const mockKvZcard = vi.mocked(kv.zcard);
  const mockKvZrange = vi.mocked(kv.zrange);
  const mockKvMget = vi.mocked(kv.mget);

  const mockGetAllGamesLeaderboardByRange = vi.mocked(getAllGamesLeaderboardByRange);
  const mockAddPoints = vi.mocked(addPoints);
  const mockCreateUserNotification = vi.mocked(createUserNotification);

  const kvStore = new Map<string, unknown>();
  const zsetStore = new Map<string, Array<{ member: string; score: number }>>();

  beforeEach(() => {
    vi.clearAllMocks();
    kvStore.clear();
    zsetStore.clear();

    mockKvSet.mockImplementation(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx) {
        if (kvStore.has(key)) {
          return null;
        }
      }
      kvStore.set(key, value);
      return 'OK';
    });

    mockKvGet.mockImplementation(async (key: string) => {
      return (kvStore.get(key) as unknown) ?? null;
    });

    mockKvDel.mockImplementation(async (...keys: string[]) => {
      let removed = 0;
      for (const key of keys) {
        if (kvStore.delete(key)) {
          removed += 1;
        }
      }
      return removed;
    });

    mockKvZadd.mockImplementation(async (key: string, item: { score: number; member: string }) => {
      const arr = zsetStore.get(key) ?? [];
      const existingIndex = arr.findIndex((entry) => entry.member === item.member);
      if (existingIndex >= 0) {
        arr.splice(existingIndex, 1);
      }
      arr.push({ member: item.member, score: item.score });
      zsetStore.set(key, arr);
      return 1;
    });

    mockKvZcard.mockImplementation(async (key: string) => {
      return (zsetStore.get(key) ?? []).length;
    });

    mockKvZrange.mockImplementation(async (key: string, start: number, end: number, options?: { rev?: boolean }) => {
      const arr = [...(zsetStore.get(key) ?? [])];
      arr.sort((a, b) => (options?.rev ? b.score - a.score : a.score - b.score));
      const finalEnd = end < 0 ? arr.length - 1 : end;
      return arr.slice(start, finalEnd + 1).map((item) => item.member);
    });

    mockKvMget.mockImplementation(async (...keys: string[]) => {
      return keys.map((key) => (kvStore.get(key) as unknown) ?? null);
    });

    mockGetAllGamesLeaderboardByRange.mockResolvedValue({
      generatedAt: 1700000000000,
      startAt: 1699392000000,
      endAt: 1699996800000,
      games: [],
      overall: [
        {
          rank: 1,
          userId: 1001,
          username: 'alice',
          totalScore: 300,
          totalPoints: 120,
          gamesPlayed: 5,
          gameBreakdown: {},
        },
        {
          rank: 2,
          userId: 1002,
          username: 'bob',
          totalScore: 200,
          totalPoints: 80,
          gamesPlayed: 4,
          gameBreakdown: {},
        },
      ],
    });

    mockAddPoints.mockResolvedValue({ success: true, balance: 999 });
    mockCreateUserNotification.mockResolvedValue({
      id: 'n1',
      userId: 1001,
      type: 'system',
      title: 'ok',
      content: 'ok',
      createdAt: Date.now(),
    });
  });

  it('settles ranking once and prevents duplicate settlement', async () => {
    const referenceTime = new Date('2026-02-11T12:00:00.000Z').getTime();

    const first = await settleRankingPeriod({
      period: 'weekly',
      operator: { id: 1, username: 'admin' },
      topN: 2,
      rewardPoints: [100, 50],
      referenceTime,
    });

    expect(first.alreadySettled).toBe(false);
    expect(first.record.status).toBe('success');
    expect(first.record.summary.granted).toBe(2);
    expect(mockAddPoints).toHaveBeenCalledTimes(2);

    const second = await settleRankingPeriod({
      period: 'weekly',
      operator: { id: 1, username: 'admin' },
      topN: 2,
      rewardPoints: [100, 50],
      referenceTime,
    });

    expect(second.alreadySettled).toBe(true);
    expect(second.record.id).toBe(first.record.id);
    expect(mockAddPoints).toHaveBeenCalledTimes(2);

    const history = await listRankingSettlementHistory('weekly', { page: 1, limit: 10 });
    expect(history.items).toHaveLength(1);
    expect(history.items[0]?.id).toBe(first.record.id);
  });

  it('blocks settlement when lock already exists', async () => {
    mockKvSet.mockImplementation(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (key.includes('rankings:settlement:lock') && options?.nx) {
        return null;
      }
      if (options?.nx && kvStore.has(key)) {
        return null;
      }
      kvStore.set(key, value);
      return 'OK';
    });

    const referenceTime = new Date('2026-02-11T12:00:00.000Z').getTime();

    await expect(
      settleRankingPeriod({
        period: 'weekly',
        operator: { id: 1, username: 'admin' },
        referenceTime,
      })
    ).rejects.toThrow('结算任务正在进行中，请稍后重试');
  });

  it('retries failed rewards and updates status', async () => {
    const referenceTime = new Date('2026-02-11T12:00:00.000Z').getTime();
    let shouldFail = true;

    mockAddPoints.mockImplementation(async (userId: number) => {
      if (shouldFail && userId === 1001) {
        throw new Error('temporary error');
      }
      return { success: true, balance: 1000 };
    });

    const first = await settleRankingPeriod({
      period: 'weekly',
      operator: { id: 1, username: 'admin' },
      topN: 2,
      rewardPoints: [100, 50],
      referenceTime,
    });

    expect(first.record.status).toBe('partial');
    expect(first.record.summary.failed).toBe(1);

    shouldFail = false;

    const retried = await settleRankingPeriod({
      period: 'weekly',
      operator: { id: 2, username: 'admin2' },
      retryFailed: true,
      referenceTime,
    });

    expect(retried.retried).toBe(true);
    expect(retried.record.status).toBe('success');
    expect(retried.record.summary.failed).toBe(0);
    expect(retried.record.summary.granted).toBe(2);
  });
});
