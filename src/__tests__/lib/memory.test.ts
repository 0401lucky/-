import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import {
  MEMORY_REVEALED_SENTINEL,
  buildMemorySessionView,
  calculateMemoryPointReward,
  flipMemoryCard,
  startMemoryGame,
  submitMemoryResult,
} from '@/lib/memory';
import type { MemoryGameSession } from '@/lib/types/game';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    ttl: vi.fn(),
    expire: vi.fn(),
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

describe('memory anti-cheat flow', () => {
  const mockKvSet = vi.mocked(kv.set);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvDel = vi.mocked(kv.del);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockKvLtrim = vi.mocked(kv.ltrim);
  let store: Map<string, unknown>;

  beforeEach(() => {
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

  it('does not expose full card layout before flip', async () => {
    const started = await startMemoryGame(1001, 'easy');
    expect(started.success).toBe(true);
    const session = started.session!;

    const view = buildMemorySessionView(session);
    expect(view.cardLayout.every((value) => value === MEMORY_REVEALED_SENTINEL)).toBe(true);
  });

  it('records moves on server and rejects tampered submit', async () => {
    const started = await startMemoryGame(1001, 'easy');
    expect(started.success).toBe(true);
    const session = started.session!;

    const layout = [...session.cardLayout];
    const pairIcon = layout[0];
    const pairIndex = layout.findIndex((icon, idx) => idx !== 0 && icon === pairIcon);
    expect(pairIndex).toBeGreaterThan(0);

    const firstFlipSession = {
      ...session,
      startedAt: Date.now() - 30_000,
      expiresAt: Date.now() + 120_000,
      firstFlippedCard: 0,
      matchedCards: [],
      moveLog: [],
    };

    store.set(`memory:session:${session.id}`, firstFlipSession);
    const secondFlip = await flipMemoryCard(1001, session.id, pairIndex);

    expect(secondFlip.success).toBe(true);
    expect(secondFlip.data?.matched).toBe(true);
    expect(secondFlip.data?.move).toMatchObject({
      card1: 0,
      card2: pairIndex,
      matched: true,
    });

    const storedAfterFlip = mockKvSet.mock.calls.find(
      (call) => call[0] === `memory:session:${session.id}` && typeof call[1] === 'object' && call[1] !== session
    )?.[1] as MemoryGameSession | undefined;

    expect(storedAfterFlip).toBeTruthy();
    expect(storedAfterFlip!.moveLog).toHaveLength(1);

    store.set(`memory:session:${session.id}`, storedAfterFlip!);

    const tampered = await submitMemoryResult(1001, {
      sessionId: session.id,
      completed: false,
      duration: 15000,
      moves: [
        {
          card1: 1,
          card2: 2,
          matched: false,
          timestamp: Date.now(),
        },
      ],
    });

    expect(tampered.success).toBe(false);
    expect(tampered.message).toBe('提交步数与服务端记录不一致');
  });

  it('settles timed-out games as failed even with an unfinished flip', async () => {
    const started = await startMemoryGame(1001, 'easy');
    expect(started.success).toBe(true);
    const session = started.session!;

    const timedOutSession: MemoryGameSession = {
      ...session,
      startedAt: Date.now() - 181_000,
      expiresAt: Date.now() + 60_000,
      firstFlippedCard: 0,
      matchedCards: [],
      moveLog: [],
    };
    store.set(`memory:session:${session.id}`, timedOutSession);

    const result = await submitMemoryResult(1001, {
      sessionId: session.id,
      completed: false,
      duration: 181_000,
      moves: [],
    });

    expect(result.success).toBe(true);
    expect(result.record?.completed).toBe(false);
    expect(result.record?.score).toBe(0);
  });

  it('按得分 10% 发放福利积分', async () => {
    expect(calculateMemoryPointReward(0)).toBe(0);
    expect(calculateMemoryPointReward(99)).toBe(9);
    expect(calculateMemoryPointReward(120)).toBe(12);

    const started = await startMemoryGame(1001, 'easy');
    expect(started.success).toBe(true);
    const session = started.session!;

    const iconMap = new Map<string, number[]>();
    session.cardLayout.forEach((icon, index) => {
      const indexes = iconMap.get(icon) ?? [];
      indexes.push(index);
      iconMap.set(icon, indexes);
    });

    const moves = Array.from(iconMap.values()).map(([card1, card2]) => ({
      card1: card1!,
      card2: card2!,
      matched: true,
      timestamp: Date.now(),
    }));
    const matchedCards = moves.flatMap((move) => [move.card1, move.card2]);

    store.set(`memory:session:${session.id}`, {
      ...session,
      startedAt: Date.now() - 30_000,
      expiresAt: Date.now() + 120_000,
      firstFlippedCard: null,
      matchedCards,
      moveLog: moves,
    } satisfies MemoryGameSession);

    const result = await submitMemoryResult(1001, {
      sessionId: session.id,
      completed: true,
      duration: 30_000,
      moves,
    });

    expect(result.success).toBe(true);
    expect(result.record?.score).toBe(120);
    expect(result.pointsEarned).toBe(12);
    expect(result.record?.pointsEarned).toBe(12);
  });
});
