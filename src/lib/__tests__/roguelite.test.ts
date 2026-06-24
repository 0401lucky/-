import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import {
  ROGUELITE_MAX_ACTIONS,
  startRogueliteGame,
  stepRogueliteGame,
  submitRogueliteResult,
  type RogueliteGameSession,
} from '../roguelite';
import { addGamePointsWithLimit } from '@/lib/points';
import type { RogueliteAction } from '../roguelite-engine';

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
  getNativeActiveGameSession: vi.fn(),
  getNativeDailyStats: vi.fn(),
  getNativeGameCooldownRemaining: vi.fn(),
  getNativeGameSession: vi.fn(),
  hasNativeHotStoreBinding: vi.fn(() => false),
  incrementNativeDailyStats: vi.fn(),
  isNativeHotStoreReady: vi.fn(async () => false),
  listNativeGameRecords: vi.fn(async () => []),
  releaseNativeLock: vi.fn(),
}));

vi.mock('@/lib/points', () => ({
  addGamePointsWithLimit: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getDailyPointsLimit: vi.fn(async () => 2000),
}));

vi.mock('@/lib/daily-stats', () => ({
  getDailyStats: vi.fn(),
  incrementSharedDailyStats: vi.fn(),
}));

function repeatedActions(count: number): RogueliteAction[] {
  return Array.from({ length: count }, () => ({
    type: 'move',
    to: { row: 0, col: 0 },
  }));
}

describe('roguelite service', () => {
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
    mockAddGamePointsWithLimit.mockResolvedValue({
      success: true,
      pointsEarned: 120,
      balance: 120,
      dailyEarned: 120,
      limitReached: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('长局达到行动日志上限后自动切段，仍可继续移动并保留总步数结算', async () => {
    const started = await startRogueliteGame(1001);
    expect(started.success).toBe(true);
    const sessionId = started.session!.id;
    const sessionKey = `roguelite:session:${sessionId}`;
    const savedSession = store.get(sessionKey) as RogueliteGameSession;

    savedSession.state.floor = 4;
    savedSession.state.player.floorsCleared = 3;
    savedSession.state.pending = undefined;
    savedSession.state.visited.push('0,1');
    savedSession.actions = repeatedActions(ROGUELITE_MAX_ACTIONS);
    store.set(sessionKey, savedSession);

    const continued = await stepRogueliteGame(1001, {
      sessionId,
      action: { type: 'move', to: { row: 0, col: 1 } },
    });

    expect(continued.success).toBe(true);
    expect(continued.session?.sessionId).toBe(sessionId);
    expect(continued.session?.actionsCount).toBe(ROGUELITE_MAX_ACTIONS + 1);
    expect(continued.session?.state.player.position).toEqual({ row: 0, col: 1 });

    const checkpointedSession = store.get(sessionKey) as RogueliteGameSession;
    expect(checkpointedSession.actionCount).toBe(ROGUELITE_MAX_ACTIONS + 1);
    expect(checkpointedSession.actionSegmentCount).toBe(1);
    expect(checkpointedSession.moveCount).toBe(ROGUELITE_MAX_ACTIONS + 1);
    expect(checkpointedSession.actions).toHaveLength(1);

    const escaped = await stepRogueliteGame(1001, {
      sessionId,
      action: { type: 'escape' },
    });

    expect(escaped.success).toBe(true);
    expect(escaped.session?.state.status).toBe('escaped');
    expect(escaped.session?.actionsCount).toBe(ROGUELITE_MAX_ACTIONS + 2);

    const compactedSession = store.get(sessionKey) as RogueliteGameSession;
    expect(compactedSession.actionCount).toBe(ROGUELITE_MAX_ACTIONS + 2);
    expect(compactedSession.actionSegmentCount).toBe(2);
    expect(compactedSession.moveCount).toBe(ROGUELITE_MAX_ACTIONS + 1);
    expect(compactedSession.actions.length).toBeLessThan(ROGUELITE_MAX_ACTIONS);

    vi.advanceTimersByTime(2_500);

    const settled = await submitRogueliteResult(1001, { sessionId });
    const retried = await submitRogueliteResult(1001, { sessionId });

    expect(settled.success).toBe(true);
    expect(settled.record?.stepsUsed).toBe(ROGUELITE_MAX_ACTIONS + 1);
    expect(retried.success).toBe(true);
    expect(retried.record).toEqual(settled.record);
    expect(retried.pointsEarned).toBe(settled.pointsEarned);
  });
});
