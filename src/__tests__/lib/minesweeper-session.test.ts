import { describe, expect, it } from 'vitest';
import { buildMinesweeperSessionView, type MinesweeperGameSession } from '@/lib/minesweeper';
import {
  createInitialMinesweeperState,
  type MinesweeperDifficulty,
} from '@/lib/minesweeper-engine';

function createSession(difficulty: MinesweeperDifficulty = 'easy'): MinesweeperGameSession {
  const seed = 'server-only-seed';
  return {
    id: 'mine-session-1',
    userId: 1001,
    gameType: 'minesweeper',
    difficulty,
    seed,
    startedAt: Date.now(),
    expiresAt: Date.now() + 300_000,
    status: 'playing',
    state: createInitialMinesweeperState(seed, difficulty),
    actions: [],
  };
}

describe('minesweeper session view', () => {
  it('does not expose the server seed', () => {
    const view = buildMinesweeperSessionView(createSession());

    expect('seed' in view).toBe(false);
    expect(view.sessionId).toBe('mine-session-1');
    expect(view.state.cells.length).toBeGreaterThan(0);
  });
});
