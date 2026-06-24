import { describe, it, expectTypeOf } from 'vitest';
import type {
  LinkGameDifficulty,
  LinkGameBoardMode,
  LinkGameDifficultyConfig,
  LinkGameLayerConfig,
  LinkGamePosition,
  LinkGameSettlementOutcome,
  LinkGameSettlementResult,
  LinkGameMove,
  LinkGameMatchMove,
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
      mode?: LinkGameBoardMode;
      depth?: number;
      layers?: LinkGameLayerConfig[];
    }>();
  });

  it('should have correct LinkGamePosition interface', () => {
    expectTypeOf<LinkGamePosition>().toMatchTypeOf<{
      row: number;
      col: number;
      z?: number;
    }>();
  });

  it('should have correct LinkGameSettlementOutcome type', () => {
    expectTypeOf<LinkGameSettlementOutcome>().toEqualTypeOf<'completed' | 'deadlock' | 'timeout'>();
  });

  it('should have correct LinkGameSettlementResult type', () => {
    expectTypeOf<LinkGameSettlementResult>().toEqualTypeOf<'win' | 'loss'>();
  });

  it('should have correct LinkGameMatchMove interface', () => {
    expectTypeOf<LinkGameMatchMove>().toMatchTypeOf<{
      type: 'match';
      pos1: LinkGamePosition;
      pos2: LinkGamePosition;
      matched: boolean;
      timestamp: number;
    }>();
  });

  it('should use match moves only after tools are removed', () => {
    expectTypeOf<LinkGameMove>().toEqualTypeOf<LinkGameMatchMove>();
  });

  it('should have correct LinkGameSession interface', () => {
    expectTypeOf<LinkGameSession>().toMatchTypeOf<{
      id: string;
      userId: number;
      gameType: 'linkgame';
      difficulty: LinkGameDifficulty;
      seed: string;
      tileLayout: (string | null)[];
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
      outcome?: LinkGameSettlementOutcome;
      duration: number;
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
      outcome?: LinkGameSettlementOutcome;
      settlementResult?: LinkGameSettlementResult;
      score: number;
      pointsEarned: number;
      duration: number;
      createdAt: number;
    }>();
  });

  it('should include linkgame in GameType', () => {
    expectTypeOf<GameType>().toMatchTypeOf<'memory' | 'match3' | 'linkgame' | 'farm' | 'whack_mole' | 'roguelite' | 'minesweeper' | 'game_2048'>();
  });
});
