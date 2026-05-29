import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { isNativeHotStoreReady } from '@/lib/hot-d1';
import { stepMinesweeperDurableSession } from '@/lib/minesweeper-durable';
import { stepMinesweeperGame } from '@/lib/minesweeper';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('@/lib/hot-d1', () => ({
  acquireNativeLock: vi.fn(),
  getNativeActiveGameSession: vi.fn(),
  getNativeGameSession: vi.fn(),
  hasNativeHotStoreBinding: vi.fn(() => false),
  isNativeHotStoreReady: vi.fn(async () => false),
  releaseNativeLock: vi.fn(),
  updateNativeGameSession: vi.fn(),
}));

vi.mock('@/lib/minesweeper-durable', () => ({
  deleteMinesweeperDurableSession: vi.fn(),
  getMinesweeperDurableSessionSnapshot: vi.fn(),
  initializeMinesweeperDurableSession: vi.fn(),
  stepMinesweeperDurableSession: vi.fn(),
}));

describe('minesweeper durable path', () => {
  const mockKvSet = vi.mocked(kv.set);
  const mockIsNativeHotStoreReady = vi.mocked(isNativeHotStoreReady);
  const mockStepMinesweeperDurableSession = vi.mocked(stepMinesweeperDurableSession);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DO 返回结果时跳过原 D1 锁和会话写入路径', async () => {
    const durableResult = {
      success: true,
      session: {
        sessionId: 'session-1',
        difficulty: 'easy' as const,
        startedAt: 1,
        expiresAt: 2,
        actionsCount: 1,
        state: {
          difficulty: 'easy' as const,
          rows: 9,
          cols: 9,
          mines: 10,
          status: 'playing' as const,
          cells: [],
          revealedSafe: 1,
          flagsUsed: 0,
          moves: 1,
        },
      },
      outcome: { type: 'reveal', message: 'ok' },
    };
    mockStepMinesweeperDurableSession.mockResolvedValueOnce(durableResult);

    const result = await stepMinesweeperGame(1001, {
      sessionId: 'session-1',
      action: { type: 'reveal', position: { row: 0, col: 0 } },
    });

    expect(result).toEqual(durableResult);
    expect(mockStepMinesweeperDurableSession).toHaveBeenCalledWith(1001, {
      sessionId: 'session-1',
      action: { type: 'reveal', position: { row: 0, col: 0 } },
    });
    expect(mockIsNativeHotStoreReady).not.toHaveBeenCalled();
    expect(mockKvSet).not.toHaveBeenCalled();
  });
});
