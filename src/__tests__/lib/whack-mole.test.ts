import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { addGamePointsWithLimit } from '@/lib/points';
import {
  buildWhackMoleSessionView,
  hitWhackMoleTarget,
  startWhackMoleGame,
  submitWhackMoleResult,
} from '@/lib/whack-mole';
import { getWhackMoleBoard, WHACK_MOLE_GAME_DURATION_MS } from '@/lib/whack-mole-engine';

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

describe('whack mole server authority', () => {
  const mockKvSet = vi.mocked(kv.set);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvDel = vi.mocked(kv.del);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockKvLtrim = vi.mocked(kv.ltrim);
  let store: Map<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.clearAllMocks();
    store = new Map<string, unknown>();
    mockKvSet.mockImplementation(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    });
    mockKvGet.mockImplementation(async (key: string) => (store.has(key) ? store.get(key) : null) as any);
    mockKvDel.mockImplementation(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (store.delete(key)) deleted++;
      }
      return deleted;
    });
    mockKvLpush.mockResolvedValue(1 as any);
    mockKvLtrim.mockResolvedValue(1 as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes the server seed in the session view so the client can render locally', async () => {
    const started = await startWhackMoleGame(1001);
    expect(started.success).toBe(true);

    const view = buildWhackMoleSessionView(started.session!);
    expect(view.seed).toBe(started.session!.seed);
    expect(view.board).toHaveLength(16);
  });

  it('scores from client-submitted events at settlement using the server seed', async () => {
    const started = await startWhackMoleGame(1001);
    const session = started.session!;

    let targetIndex = -1;
    let targetElapsedMs = 0;
    for (let elapsedMs = 1_000; elapsedMs < 5_000; elapsedMs += 10) {
      const board = getWhackMoleBoard(session.seed, elapsedMs);
      const candidate = board.findIndex((cell) => cell === 'mole' || cell === 'golden');
      if (candidate >= 0) {
        targetIndex = candidate;
        targetElapsedMs = elapsedMs;
        break;
      }
    }
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    vi.setSystemTime(new Date(Date.now() + WHACK_MOLE_GAME_DURATION_MS));
    const result = await submitWhackMoleResult(1001, {
      sessionId: session.id,
      events: [{ index: targetIndex, elapsedMs: targetElapsedMs }],
    });

    expect(result.success).toBe(true);
    expect(result.record?.score).toBeGreaterThan(0);
    expect(result.record?.hits).toBe(1);
    expect(result.record?.goldenHits).toBe(
      getWhackMoleBoard(session.seed, targetElapsedMs)[targetIndex] === 'golden' ? 1 : 0,
    );
    expect(result.pointsEarned).toBe(Math.floor((result.record?.score ?? 0) / 10));
  });

  it('records hits using server time before settlement', async () => {
    const started = await startWhackMoleGame(1001);
    const session = started.session!;

    vi.setSystemTime(new Date(Date.now() + 1_000));
    const board = getWhackMoleBoard(session.seed, 1_000);
    const targetIndex = board.findIndex((cell) => cell === 'mole' || cell === 'golden');
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    const hit = await hitWhackMoleTarget(1001, { sessionId: session.id, index: targetIndex });
    expect(hit.success).toBe(true);
    expect(hit.data?.score).toBeGreaterThan(0);

    vi.setSystemTime(new Date(Date.now() + WHACK_MOLE_GAME_DURATION_MS));
    const result = await submitWhackMoleResult(1001, { sessionId: session.id });
    expect(result.success).toBe(true);
    expect(result.record?.score).toBe(hit.data?.score);
    expect(addGamePointsWithLimit).toHaveBeenCalledWith(
      1001,
      Math.floor((hit.data?.score ?? 0) / 10),
      2000,
      'game_play',
      expect.stringContaining('福利积分'),
    );
  });

  it('keeps a short grace window for visible targets crossing a refresh tick', async () => {
    const started = await startWhackMoleGame(1001);
    const session = started.session!;
    let targetIndex = -1;
    let serverElapsed = 0;

    for (let elapsedMs = 1_000; elapsedMs < WHACK_MOLE_GAME_DURATION_MS - 300; elapsedMs += 10) {
      const board = getWhackMoleBoard(session.seed, elapsedMs);
      const candidateIndex = board.findIndex((cell) => cell === 'mole' || cell === 'golden');
      if (candidateIndex < 0) continue;

      const delayedElapsed = elapsedMs + 180;
      if (getWhackMoleBoard(session.seed, delayedElapsed)[candidateIndex] === 'empty') {
        targetIndex = candidateIndex;
        serverElapsed = delayedElapsed;
        break;
      }
    }

    expect(targetIndex).toBeGreaterThanOrEqual(0);

    vi.setSystemTime(new Date(session.startedAt + serverElapsed));
    const hit = await hitWhackMoleTarget(1001, { sessionId: session.id, index: targetIndex });

    expect(hit.success).toBe(true);
    expect(hit.data?.result).not.toBe('miss');
    expect(hit.data?.score).toBeGreaterThan(0);
  });

  it('uses the original press time when a visible hit request arrives late', async () => {
    const started = await startWhackMoleGame(1001);
    const session = started.session!;
    let targetIndex = -1;
    let clickElapsed = 0;
    let serverElapsed = 0;

    for (let elapsedMs = 1_000; elapsedMs < WHACK_MOLE_GAME_DURATION_MS - 1_000; elapsedMs += 10) {
      const board = getWhackMoleBoard(session.seed, elapsedMs);
      const candidateIndex = board.findIndex((cell) => cell === 'mole' || cell === 'golden');
      if (candidateIndex < 0) continue;

      const delayedElapsed = elapsedMs + 650;
      if (getWhackMoleBoard(session.seed, delayedElapsed)[candidateIndex] === 'empty') {
        targetIndex = candidateIndex;
        clickElapsed = elapsedMs;
        serverElapsed = delayedElapsed;
        break;
      }
    }

    expect(targetIndex).toBeGreaterThanOrEqual(0);

    vi.setSystemTime(new Date(session.startedAt + serverElapsed));
    const hit = await hitWhackMoleTarget(1001, {
      sessionId: session.id,
      index: targetIndex,
      clientElapsedMs: clickElapsed,
    });

    expect(hit.success).toBe(true);
    expect(hit.data?.result).not.toBe('miss');
    expect(hit.data?.score).toBeGreaterThan(0);
  });

  it('accepts a valid press before time runs out even if the request arrives after 60 seconds', async () => {
    const started = await startWhackMoleGame(1001);
    const session = started.session!;
    let targetIndex = -1;
    let clickElapsed = 0;

    for (let elapsedMs = WHACK_MOLE_GAME_DURATION_MS - 1_000; elapsedMs < WHACK_MOLE_GAME_DURATION_MS - 80; elapsedMs += 10) {
      const board = getWhackMoleBoard(session.seed, elapsedMs);
      const candidateIndex = board.findIndex((cell) => cell === 'mole' || cell === 'golden');
      if (candidateIndex >= 0) {
        targetIndex = candidateIndex;
        clickElapsed = elapsedMs;
        break;
      }
    }

    expect(targetIndex).toBeGreaterThanOrEqual(0);

    vi.setSystemTime(new Date(session.startedAt + WHACK_MOLE_GAME_DURATION_MS + 450));
    const hit = await hitWhackMoleTarget(1001, {
      sessionId: session.id,
      index: targetIndex,
      clientElapsedMs: clickElapsed,
    });

    expect(hit.success).toBe(true);
    expect(hit.data?.result).not.toBe('miss');
    expect(hit.data?.score).toBeGreaterThan(0);
  });

  it('rejects settlement before the full round has elapsed', async () => {
    const started = await startWhackMoleGame(1001);
    const session = started.session!;

    vi.setSystemTime(new Date(Date.now() + 55_000));
    const result = await submitWhackMoleResult(1001, { sessionId: session.id });

    expect(result.success).toBe(false);
    expect(result.message).toBe('游戏尚未结束');
  });
});
