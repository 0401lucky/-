import { describe, it, expectTypeOf } from 'vitest';
import type {
  LinkGameDifficulty,
  LinkGameDifficultyConfig,
  LinkGamePosition,
  LinkGameMove,
  LinkGameSession,
  LinkGameResultSubmit,
  LinkGameRecord,
  GameType
} from '@/lib/types/game';

describe('LinkGame Types', () => {
  it('should have correct LinkGameDifficulty type', () => {
    expectTypeOf<LinkGameDifficulty>().toEqualTypeOf<'easy' | 'normal' | 'hard'>();
  });

  it('should have correct LinkGameDifficultyConfig interface', () => {
    expectTypeOf<LinkGameDifficultyConfig>().toMatchTypeOf<{
      rows: number;
      cols: number;
      pairs: number;
      baseScore: number;
      timeLimit: number;
      hintLimit: number;
      shuffleLimit: number;
      hintPenalty: number;
      shufflePenalty: number;
    }>();
  });

  it('should have correct LinkGamePosition interface', () => {
    expectTypeOf<LinkGamePosition>().toMatchTypeOf<{
      row: number;
      col: number;
    }>();
  });

  it('should have correct LinkGameMove interface', () => {
    expectTypeOf<LinkGameMove>().toMatchTypeOf<{
      pos1: LinkGamePosition;
      pos2: LinkGamePosition;
      matched: boolean;
      timestamp: number;
    }>();
  });

  it('should have correct LinkGameSession interface', () => {
    expectTypeOf<LinkGameSession>().toMatchTypeOf<{
      id: string;
      userId: number;
      gameType: 'linkgame';
      difficulty: LinkGameDifficulty;
      seed: string;
      tileLayout: string[];
      startedAt: number;
      expiresAt: number;
      status: 'playing' | 'completed' | 'expired';
    }>();
  });

  it('should have correct LinkGameResultSubmit interface', () => {
    expectTypeOf<LinkGameResultSubmit>().toMatchTypeOf<{
      sessionId: string;
      moves: LinkGameMove[];
      completed: boolean;
      duration: number;
      hintsUsed: number;
      shufflesUsed: number;
    }>();
  });

  it('should have correct LinkGameRecord interface', () => {
    expectTypeOf<LinkGameRecord>().toMatchTypeOf<{
      id: string;
      userId: number;
      sessionId: string;
      gameType: 'linkgame';
      difficulty: LinkGameDifficulty;
      moves: number;
      completed: boolean;
      score: number;
      pointsEarned: number;
      duration: number;
      createdAt: number;
    }>();
  });

  it('should include linkgame in GameType', () => {
    expectTypeOf<GameType>().toMatchTypeOf<'pachinko' | 'memory' | 'slot' | 'match3' | 'linkgame'>();
  });
});
