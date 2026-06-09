import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import {
  ROGUELITE_MAX_ACTIONS,
  startRogueliteGame,
  stepRogueliteGame,
  type RogueliteGameSession,
} from '../roguelite';
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('长局达到行动日志上限后阻止继续行动，但仍允许撤离结算', async () => {
    const started = await startRogueliteGame(1001);
    expect(started.success).toBe(true);
    const sessionId = started.session!.id;
    const sessionKey = `roguelite:session:${sessionId}`;
    const savedSession = store.get(sessionKey) as RogueliteGameSession;

    savedSession.state.floor = 4;
    savedSession.state.player.floorsCleared = 3;
    savedSession.state.pending = undefined;
    savedSession.actions = repeatedActions(ROGUELITE_MAX_ACTIONS);
    store.set(sessionKey, savedSession);

    const blocked = await stepRogueliteGame(1001, {
      sessionId,
      action: { type: 'move', to: { row: 0, col: 1 } },
    });

    expect(blocked.success).toBe(false);
    expect(blocked.message).toContain('行动次数过多');
    expect(blocked.session?.sessionId).toBe(sessionId);
    expect(blocked.session?.actionsCount).toBe(ROGUELITE_MAX_ACTIONS);
    expect((store.get(sessionKey) as RogueliteGameSession).actions).toHaveLength(ROGUELITE_MAX_ACTIONS);

    const escaped = await stepRogueliteGame(1001, {
      sessionId,
      action: { type: 'escape' },
    });

    expect(escaped.success).toBe(true);
    expect(escaped.session?.state.status).toBe('escaped');
    expect(escaped.session?.actionsCount).toBe(ROGUELITE_MAX_ACTIONS + 1);
  });
});
