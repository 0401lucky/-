import { describe, expect, it } from 'vitest';
import {
  LINKGAME_DIFFICULTY_CONFIG,
  findHintByConfig,
  getActivePositions,
  indexOfPosition,
} from '@/lib/linkgame';
import {
  LINKGAME_SESSION_SETTLEMENT_GRACE_SECONDS,
  LINKGAME_SESSION_TTL_SECONDS,
  validateLinkGameSettlementTiming,
  validateLinkGameResult,
} from '@/lib/linkgame-server';
import type { LinkGameResultSubmit, LinkGameSession } from '@/lib/types/game';

function createSession(tileLayout: (string | null)[], difficulty: LinkGameSession['difficulty'] = 'easy'): LinkGameSession {
  return {
    id: 'test-session',
    userId: 1001,
    gameType: 'linkgame',
    difficulty,
    seed: 'test-seed',
    tileLayout,
    startedAt: Date.now() - 10_000,
    expiresAt: Date.now() + 60_000,
    status: 'playing',
  };
}

describe('linkgame server validation', () => {
  it('should keep a settlement grace window after hard mode time limit', () => {
    expect(LINKGAME_SESSION_SETTLEMENT_GRACE_SECONDS).toBe(60);
    expect(LINKGAME_SESSION_TTL_SECONDS).toBeGreaterThan(LINKGAME_DIFFICULTY_CONFIG.hard.timeLimit);
  });

  it('should reject removed hint moves', () => {
    const session = createSession(generateEasyBoard());
    const payload: LinkGameResultSubmit = {
      sessionId: session.id,
      moves: [{ type: 'hint', timestamp: 1 } as never],
      completed: false,
      duration: 1000,
    };

    expect(validateLinkGameResult(session, payload)).toEqual({
      ok: false,
      message: '道具已移除',
    });
  });

  it('should reject removed shuffle moves', () => {
    const session = createSession(generateEasyBoard());
    const payload: LinkGameResultSubmit = {
      sessionId: session.id,
      moves: [{ type: 'shuffle', timestamp: 1 } as never],
      completed: false,
      duration: 1000,
    };

    expect(validateLinkGameResult(session, payload)).toEqual({
      ok: false,
      message: '道具已移除',
    });
  });

  it('should validate stack3d adjacent matches', () => {
    const config = LINKGAME_DIFFICULTY_CONFIG.hard;
    const board = new Array<string | null>(config.rows * config.cols * (config.depth ?? 1)).fill(null);
    const pos1 = { row: 2, col: 2, z: 2 };
    const pos2 = { row: 2, col: 3, z: 2 };
    board[indexOfPosition(pos1, config)] = 'A';
    board[indexOfPosition(pos2, config)] = 'A';

    const session = createSession(board, 'hard');
    const payload: LinkGameResultSubmit = {
      sessionId: session.id,
      moves: [{ type: 'match', pos1, pos2, matched: true, timestamp: 1 }],
      completed: true,
      duration: 1000,
    };

    expect(validateLinkGameResult(session, payload)).toMatchObject({
      ok: true,
      matchedPairs: 1,
      completed: true,
      outcome: 'completed',
    });
  });

  it('should validate hard deadlock settlement when no match remains', () => {
    const config = LINKGAME_DIFFICULTY_CONFIG.hard;
    const board = generateHardDeadlockBoard();
    expect(findHintByConfig(board, config)).toBeNull();

    const session = createSession(board, 'hard');
    const payload: LinkGameResultSubmit = {
      sessionId: session.id,
      moves: [],
      completed: false,
      outcome: 'deadlock',
      duration: 1000,
    };

    expect(validateLinkGameResult(session, payload)).toMatchObject({
      ok: true,
      matchedPairs: 0,
      completed: false,
      deadlocked: true,
      outcome: 'deadlock',
    });
  });

  it('should reject hard deadlock settlement while a match exists', () => {
    const config = LINKGAME_DIFFICULTY_CONFIG.hard;
    const board = new Array<string | null>(config.rows * config.cols * (config.depth ?? 1)).fill(null);
    const pos1 = { row: 2, col: 3, z: 4 };
    const pos2 = { row: 5, col: 4, z: 4 };
    board[indexOfPosition(pos1, config)] = 'A';
    board[indexOfPosition(pos2, config)] = 'A';

    const session = createSession(board, 'hard');
    const payload: LinkGameResultSubmit = {
      sessionId: session.id,
      moves: [],
      completed: false,
      outcome: 'deadlock',
      duration: 1000,
    };

    expect(validateLinkGameResult(session, payload)).toEqual({
      ok: false,
      message: '当前牌面仍有可消除的牌',
    });
  });

  it('should validate easy deadlock settlement when no match remains', () => {
    const config = LINKGAME_DIFFICULTY_CONFIG.easy;
    const board = generateEasyDeadlockBoard();
    expect(findHintByConfig(board, config)).toBeNull();

    const session = createSession(board, 'easy');
    const payload: LinkGameResultSubmit = {
      sessionId: session.id,
      moves: [],
      completed: false,
      outcome: 'deadlock',
      duration: 1000,
    };

    expect(validateLinkGameResult(session, payload)).toMatchObject({
      ok: true,
      matchedPairs: 0,
      completed: false,
      deadlocked: true,
      outcome: 'deadlock',
    });
  });

  it('should reject easy deadlock settlement while a match exists', () => {
    const session = createSession(generateEasyBoard(), 'easy');
    const payload: LinkGameResultSubmit = {
      sessionId: session.id,
      moves: [],
      completed: false,
      outcome: 'deadlock',
      duration: 1000,
    };

    expect(validateLinkGameResult(session, payload)).toEqual({
      ok: false,
      message: '当前牌面仍有可消除的牌',
    });
  });

  it('should reject early timeout settlement', () => {
    expect(
      validateLinkGameSettlementTiming(
        10_000,
        LINKGAME_DIFFICULTY_CONFIG.hard,
        'timeout'
      )
    ).toEqual({
      ok: false,
      message: '游戏尚未超时',
    });
  });

  it('should reject completed settlement after the difficulty time limit', () => {
    const config = LINKGAME_DIFFICULTY_CONFIG.easy;

    expect(
      validateLinkGameSettlementTiming(
        config.timeLimit * 1000 + 1,
        config,
        'completed'
      )
    ).toEqual({
      ok: false,
      message: '游戏已超时',
    });
  });

  it('should apply minimum duration to deadlock settlement', () => {
    expect(
      validateLinkGameSettlementTiming(
        1_000,
        LINKGAME_DIFFICULTY_CONFIG.hard,
        'deadlock'
      )
    ).toEqual({
      ok: false,
      message: '游戏时长过短',
    });
  });
});

function generateEasyBoard(): (string | null)[] {
  const board = new Array<string | null>(LINKGAME_DIFFICULTY_CONFIG.easy.rows * LINKGAME_DIFFICULTY_CONFIG.easy.cols).fill(null);
  board[0] = 'A';
  board[1] = 'A';
  return board;
}

function generateEasyDeadlockBoard(): (string | null)[] {
  return Array.from(
    { length: LINKGAME_DIFFICULTY_CONFIG.easy.rows * LINKGAME_DIFFICULTY_CONFIG.easy.cols },
    (_, index) => `T${index}`,
  );
}

function generateHardDeadlockBoard(): (string | null)[] {
  const config = LINKGAME_DIFFICULTY_CONFIG.hard;
  const board = new Array<string | null>(config.rows * config.cols * (config.depth ?? 1)).fill(null);
  getActivePositions(config).forEach((pos, index) => {
    board[indexOfPosition(pos, config)] = `T${index}`;
  });
  return board;
}
