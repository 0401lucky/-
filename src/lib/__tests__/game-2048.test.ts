import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import {
  GAME2048_MAX_POINT_REWARD,
  calculateGame2048PointReward,
  moveGame2048Grid,
  simulateGame2048,
  type Game2048Direction,
} from '../game-2048-engine';
import {
  checkpointGame2048,
  settleGame2048Fallback,
  startGame2048,
  submitGame2048Result,
} from '../game-2048';
import { settleGameFallbackTransfer } from '../game-fallback';
import { addGamePointsWithLimit } from '../points';

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

vi.mock('../hot-d1', () => ({
  acquireNativeLock: vi.fn(),
  cancelNativeGameSession: vi.fn(),
  completeNativeGameSettlement: vi.fn(),
  createNativeGameSession: vi.fn(),
  getNativeActiveGameSession: vi.fn(),
  getNativeGameCooldownRemaining: vi.fn(),
  getNativeGameSession: vi.fn(),
  hasNativeHotStoreBinding: vi.fn(() => false),
  incrementNativeDailyStats: vi.fn(),
  isNativeHotStoreReady: vi.fn(async () => false),
  listNativeGameRecords: vi.fn(async () => []),
  releaseNativeLock: vi.fn(),
}));

vi.mock('../points', () => ({
  addGamePointsWithLimit: vi.fn(),
}));

vi.mock('../config', () => ({
  getDailyPointsLimit: vi.fn(async () => 2000),
}));

vi.mock('../daily-stats', () => ({
  getDailyStats: vi.fn(async () => ({
    userId: 1001,
    date: '2026-06-22',
    gamesPlayed: 0,
    totalScore: 0,
    pointsEarned: 0,
    lastGameAt: 0,
  })),
  incrementSharedDailyStats: vi.fn(),
}));

vi.mock('../game-fallback', () => ({
  settleGameFallbackTransfer: vi.fn(),
}));

describe('game-2048-engine', () => {
  it('按传统 2048 规则向左合并，且同一方块不会连续合并两次', () => {
    const result = moveGame2048Grid([
      [2, 2, 2, 2, 2],
      [2, 2, 4, 0, 4],
      [4, 0, 4, 4, 4],
      [0, 0, 0, 0, 0],
      [8, 8, 8, 0, 8],
    ], 'left');

    expect(result.moved).toBe(true);
    expect(result.grid[0]).toEqual([4, 4, 2, 0, 0]);
    expect(result.grid[1]).toEqual([4, 8, 0, 0, 0]);
    expect(result.grid[2]).toEqual([8, 8, 0, 0, 0]);
    expect(result.grid[4]).toEqual([16, 16, 0, 0, 0]);
    expect(result.scoreDelta).toBe(68);
  });

  it('使用种子和操作序列得到稳定结算结果', () => {
    const moves: Game2048Direction[] = ['left', 'up', 'right', 'down', 'left'];
    const first = simulateGame2048('fixed-seed', moves);
    const second = simulateGame2048('fixed-seed', moves);

    expect(first).toEqual(second);
    expect(first.ok && first.movesSubmitted).toBe(moves.length);
  });

  it('按得分和最高方块计算积分，并限制单局上限', () => {
    expect(calculateGame2048PointReward(0, 2)).toBe(0);
    expect(calculateGame2048PointReward(127, 128)).toBe(0);
    expect(calculateGame2048PointReward(128, 128)).toBe(1);
    expect(calculateGame2048PointReward(2048, 2048)).toBe(96);
    expect(calculateGame2048PointReward(999999, 4096)).toBe(GAME2048_MAX_POINT_REWARD);
  });
});

describe('game-2048 service fallback', () => {
  const mockKvSet = vi.mocked(kv.set);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvDel = vi.mocked(kv.del);
  const mockKvTtl = vi.mocked(kv.ttl);
  const mockKvLrange = vi.mocked(kv.lrange);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockKvLtrim = vi.mocked(kv.ltrim);
  const mockSettleGameFallbackTransfer = vi.mocked(settleGameFallbackTransfer);
  const mockAddGamePointsWithLimit = vi.mocked(addGamePointsWithLimit);

  let store: Map<string, unknown>;
  let lists: Map<string, unknown[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-22T08:00:00.000Z'));
    vi.clearAllMocks();
    store = new Map<string, unknown>();
    lists = new Map<string, unknown[]>();

    mockKvSet.mockImplementation(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    });
    mockKvGet.mockImplementation(async (key: string) => (
      store.has(key) ? store.get(key) : null
    ) as never);
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
    mockKvLpush.mockImplementation(async (key: string, value: unknown) => {
      const list = lists.get(key) ?? [];
      list.unshift(value);
      lists.set(key, list);
      return list.length;
    });
    mockKvLtrim.mockImplementation(async (key: string, start: number, stop: number) => {
      const list = lists.get(key) ?? [];
      const end = stop < 0 ? list.length + stop : stop;
      lists.set(key, list.slice(start, end + 1));
    });
    mockAddGamePointsWithLimit.mockImplementation(async (_userId, amount) => ({
      success: true,
      pointsEarned: amount,
      balance: amount,
      dailyEarned: amount,
      limitReached: false,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('兜底结算使用服务端重放分数，并通过 2048 兜底键转账', async () => {
    const started = await startGame2048(1001);
    expect(started.success).toBe(true);
    const session = started.session!;
    const moves: Game2048Direction[] = ['left', 'up', 'right', 'down', 'left', 'up'];
    const simulated = simulateGame2048(session.seed, moves);
    expect(simulated.ok).toBe(true);

    const expectedReward = simulated.ok
      ? calculateGame2048PointReward(simulated.score, simulated.highestTile)
      : 0;
    mockSettleGameFallbackTransfer.mockResolvedValue({
      success: true,
      pointsEarned: expectedReward,
      alreadySettled: false,
    });

    const result = await settleGame2048Fallback(1001, {
      sessionId: session.id,
      moves,
    });

    expect(result.success).toBe(true);
    expect(result.record?.score).toBe(simulated.ok ? simulated.score : 0);
    expect(result.record?.pointsEarned).toBe(expectedReward);
    expect(mockSettleGameFallbackTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        gameKey: '2048',
        sessionId: session.id,
        userId: 1001,
        score: simulated.ok ? simulated.score : 0,
        pointReward: expectedReward,
        gameName: '2048',
      }),
    );
  });

  it('支持检查点分段后继续提交，分数与整局重放一致', async () => {
    const started = await startGame2048(1001);
    expect(started.success).toBe(true);
    const session = started.session!;
    const firstSegment: Game2048Direction[] = ['left', 'up', 'right', 'down', 'left', 'up', 'right'];
    const secondSegment: Game2048Direction[] = ['down', 'left', 'up', 'right', 'down'];
    const fullSimulation = simulateGame2048(session.seed, [...firstSegment, ...secondSegment]);
    expect(fullSimulation.ok).toBe(true);

    const checkpoint = await checkpointGame2048(1001, {
      sessionId: session.id,
      moves: firstSegment,
    });
    expect(checkpoint.success).toBe(true);
    expect(checkpoint.session?.checkpointMovesApplied).toBe(firstSegment.length);

    const result = await submitGame2048Result(1001, {
      sessionId: session.id,
      moves: secondSegment,
    });

    expect(result.success).toBe(true);
    expect(result.record?.score).toBe(fullSimulation.ok ? fullSimulation.score : 0);
    expect(result.record?.moves).toBe(fullSimulation.ok ? fullSimulation.movesApplied : 0);
    expect(result.record?.movesSubmitted).toBe(firstSegment.length + secondSegment.length);
  });
});
