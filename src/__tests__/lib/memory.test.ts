import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';
import {
  MEMORY_REVEALED_SENTINEL,
  buildMemorySessionView,
  flipMemoryCard,
  startMemoryGame,
  submitMemoryResult,
} from '@/lib/memory';
import type { MemoryGameSession } from '@/lib/types/game';

vi.mock('@vercel/kv', () => ({
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvSet.mockResolvedValue('OK');
    mockKvDel.mockResolvedValue(1);
    mockKvLpush.mockResolvedValue(1);
    mockKvLtrim.mockResolvedValue(1);
  });

  it('does not expose full card layout before flip', async () => {
    mockKvGet.mockResolvedValueOnce(null);

    const started = await startMemoryGame(1001, 'easy');
    expect(started.success).toBe(true);
    const session = started.session!;

    const view = buildMemorySessionView(session);
    expect(view.cardLayout.every((value) => value === MEMORY_REVEALED_SENTINEL)).toBe(true);
  });

  it('records moves on server and rejects tampered submit', async () => {
    mockKvGet.mockResolvedValueOnce(null);

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

    mockKvGet.mockResolvedValueOnce(firstFlipSession);
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
    expect(storedAfterFlip.moveLog).toHaveLength(1);

    mockKvGet.mockResolvedValueOnce(storedAfterFlip);

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
});
