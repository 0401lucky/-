import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { addGamePointsWithLimit } from '@/lib/points';
import {
  startMinesweeperGame,
  stepMinesweeperGame,
  submitMinesweeperResult,
  type MinesweeperGameSession,
} from '@/lib/minesweeper';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    ttl: vi.fn(),
    lrange: vi.fn(),
    lpush: vi.fn(),
    ltrim: vi.fn(),
  },
}));

vi.mock('@/lib/hot-d1', () => ({
  acquireNativeLock: vi.fn(),
  cancelNativeGameSession: vi.fn(),
  completeNativeGameSettlement: vi.fn(),
  createNativeGameSession: vi.fn(),
  getNativeDailyStats: vi.fn(),
  getNativeActiveGameSession: vi.fn(),
  getNativeGameCooldownRemaining: vi.fn(),
  getNativeGameSession: vi.fn(),
  incrementNativeDailyStats: vi.fn(),
  isNativeHotStoreReady: vi.fn(async () => false),
  listNativeGameRecords: vi.fn(async () => []),
  releaseNativeLock: vi.fn(),
}));

vi.mock('@/lib/points', () => ({
  addGamePointsWithLimit: vi.fn(async (_userId: number, points: number) => ({
    success: true,
    pointsEarned: points,
    dailyEarned: points,
  })),
}));

vi.mock('@/lib/config', () => ({
  getDailyPointsLimit: vi.fn(async () => 2000),
}));

describe('minesweeper settlement', () => {
  const mockKvSet = vi.mocked(kv.set);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvDel = vi.mocked(kv.del);
  const mockKvTtl = vi.mocked(kv.ttl);
  const mockKvLrange = vi.mocked(kv.lrange);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockKvLtrim = vi.mocked(kv.ltrim);
  const mockAddGamePointsWithLimit = vi.mocked(addGamePointsWithLimit);
  let store: Map<string, unknown>;
  let lists: Map<string, unknown[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.clearAllMocks();
    store = new Map<string, unknown>();
    lists = new Map<string, unknown[]>();

    mockKvSet.mockImplementation(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    });
    mockKvGet.mockImplementation(async (key: string) => (store.has(key) ? store.get(key) : null) as never);
    mockKvDel.mockImplementation(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (store.delete(key)) deleted += 1;
        if (lists.delete(key)) deleted += 1;
      }
      return deleted;
    });
    mockKvTtl.mockResolvedValue(-1);
    mockKvLrange.mockImplementation(async (key: string, start: number, stop: number) => {
      const list = lists.get(key) ?? [];
      const end = stop < 0 ? list.length + stop : stop;
      return list.slice(start, end + 1) as never;
    });
    mockKvLpush.mockImplementation(async (key: string, ...values: unknown[]) => {
      const list = lists.get(key) ?? [];
      list.unshift(...values);
      lists.set(key, list);
      return list.length;
    });
    mockKvLtrim.mockImplementation(async (key: string, start: number, stop: number) => {
      const list = lists.get(key) ?? [];
      const end = stop < 0 ? list.length + stop : stop;
      lists.set(key, list.slice(start, end + 1));
      return 'OK' as never;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('重复提交已完成扫雷结算时返回原记录，不再次发放积分', async () => {
    const started = await startMinesweeperGame(1001, 'easy');
    expect(started.success).toBe(true);
    const sessionId = started.session!.id;

    const firstReveal = await stepMinesweeperGame(1001, {
      sessionId,
      action: { type: 'reveal', position: { row: 0, col: 0 } },
    });
    expect(firstReveal.success).toBe(true);

    const savedSession = store.get(`minesweeper:session:${sessionId}`) as MinesweeperGameSession;
    const mine = savedSession.state.cells.find((cell) => cell.mine);
    expect(mine).toBeTruthy();

    const lost = await stepMinesweeperGame(1001, {
      sessionId,
      action: { type: 'reveal', position: { row: mine!.row, col: mine!.col } },
    });
    expect(lost.success).toBe(true);

    const settled = await submitMinesweeperResult(1001, { sessionId });
    const retried = await submitMinesweeperResult(1001, { sessionId });

    expect(settled.success).toBe(true);
    expect(retried.success).toBe(true);
    expect(retried.record).toEqual(settled.record);
    expect(retried.pointsEarned).toBe(settled.pointsEarned);
    expect(mockAddGamePointsWithLimit).toHaveBeenCalledTimes(1);
  });
});
