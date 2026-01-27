import { describe, it, expect } from 'vitest';
import {
  LINKGAME_TILE_IDS,
  LINKGAME_DIFFICULTY_CONFIG,
  LINKGAME_TILE_TYPE_COUNT,
  generateTileLayout,
  indexOf,
  positionOf,
  getTile,
  canMatch,
  removeMatch,
  findHint,
  shuffleBoard,
  checkGameComplete,
  calculateScore,
} from '@/lib/linkgame';

describe('linkgame', () => {
  describe('LINKGAME_TILE_IDS', () => {
    it('should have at least 16 tile IDs', () => {
      expect(LINKGAME_TILE_IDS.length).toBeGreaterThanOrEqual(16);
    });
  });

  describe('LINKGAME_DIFFICULTY_CONFIG', () => {
    it('should have configs for easy, normal, hard', () => {
      expect(LINKGAME_DIFFICULTY_CONFIG.easy).toBeDefined();
      expect(LINKGAME_DIFFICULTY_CONFIG.normal).toBeDefined();
      expect(LINKGAME_DIFFICULTY_CONFIG.hard).toBeDefined();
    });

    it('easy should have 4x4 grid with 8 pairs', () => {
      const cfg = LINKGAME_DIFFICULTY_CONFIG.easy;
      expect(cfg.rows).toBe(4);
      expect(cfg.cols).toBe(4);
      expect(cfg.pairs).toBe(8);
      expect(cfg.rows * cfg.cols).toBe(cfg.pairs * 2);
    });

    it('normal should have 6x6 grid with 18 pairs', () => {
      const cfg = LINKGAME_DIFFICULTY_CONFIG.normal;
      expect(cfg.rows).toBe(6);
      expect(cfg.cols).toBe(6);
      expect(cfg.pairs).toBe(18);
    });

    it('hard should have 8x8 grid with 32 pairs', () => {
      const cfg = LINKGAME_DIFFICULTY_CONFIG.hard;
      expect(cfg.rows).toBe(8);
      expect(cfg.cols).toBe(8);
      expect(cfg.pairs).toBe(32);
    });
  });

  describe('generateTileLayout', () => {
    it('should produce correct length for easy difficulty', () => {
      const layout = generateTileLayout('easy', 'test-seed');
      expect(layout.length).toBe(16);
    });

    it('should produce correct length for normal difficulty', () => {
      const layout = generateTileLayout('normal', 'test-seed');
      expect(layout.length).toBe(36);
    });

    it('should produce correct length for hard difficulty', () => {
      const layout = generateTileLayout('hard', 'test-seed');
      expect(layout.length).toBe(64);
    });

    it('should have each tile count as even (pairs)', () => {
      const layout = generateTileLayout('easy', 'test-seed');
      const counts = new Map<string, number>();
      for (const tile of layout) {
        counts.set(tile, (counts.get(tile) || 0) + 1);
      }
      for (const count of counts.values()) {
        expect(count % 2).toBe(0);
      }
    });

    it('should be deterministic with same seed', () => {
      const layout1 = generateTileLayout('easy', 'deterministic');
      const layout2 = generateTileLayout('easy', 'deterministic');
      expect(layout1).toEqual(layout2);
    });

    it('should differ with different seeds', () => {
      const layout1 = generateTileLayout('easy', 'seed-a');
      const layout2 = generateTileLayout('easy', 'seed-b');
      expect(layout1).not.toEqual(layout2);
    });

    it('easy should use only 4 tile types', () => {
      const layout = generateTileLayout('easy', 'type-count-test');
      const uniqueTiles = new Set(layout);
      expect(uniqueTiles.size).toBe(LINKGAME_TILE_TYPE_COUNT.easy);
      expect(uniqueTiles.size).toBe(4);
    });

    it('normal should use only 6 tile types', () => {
      const layout = generateTileLayout('normal', 'type-count-test');
      const uniqueTiles = new Set(layout);
      expect(uniqueTiles.size).toBe(LINKGAME_TILE_TYPE_COUNT.normal);
      expect(uniqueTiles.size).toBe(6);
    });

    it('hard should use only 8 tile types', () => {
      const layout = generateTileLayout('hard', 'type-count-test');
      const uniqueTiles = new Set(layout);
      expect(uniqueTiles.size).toBe(LINKGAME_TILE_TYPE_COUNT.hard);
      expect(uniqueTiles.size).toBe(8);
    });
  });

  describe('indexOf and positionOf', () => {
    it('indexOf should convert position to index', () => {
      expect(indexOf({ row: 0, col: 0 }, 4)).toBe(0);
      expect(indexOf({ row: 0, col: 3 }, 4)).toBe(3);
      expect(indexOf({ row: 1, col: 0 }, 4)).toBe(4);
      expect(indexOf({ row: 2, col: 1 }, 4)).toBe(9);
    });

    it('positionOf should convert index to position', () => {
      expect(positionOf(0, 4)).toEqual({ row: 0, col: 0 });
      expect(positionOf(3, 4)).toEqual({ row: 0, col: 3 });
      expect(positionOf(4, 4)).toEqual({ row: 1, col: 0 });
      expect(positionOf(9, 4)).toEqual({ row: 2, col: 1 });
    });
  });

  describe('getTile', () => {
    it('should return tile at position', () => {
      const board = ['A', 'B', 'C', 'D'];
      expect(getTile(board, { row: 0, col: 0 }, 2)).toBe('A');
      expect(getTile(board, { row: 0, col: 1 }, 2)).toBe('B');
      expect(getTile(board, { row: 1, col: 0 }, 2)).toBe('C');
      expect(getTile(board, { row: 1, col: 1 }, 2)).toBe('D');
    });

    it('should return null for out of bounds', () => {
      const board = ['A', 'B', 'C', 'D'];
      expect(getTile(board, { row: 5, col: 5 }, 2)).toBe(null);
    });
  });

  describe('canMatch', () => {
    it('should return true for adjacent horizontal match', () => {
      const board = ['A', 'A', 'B', 'B'];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 0, col: 1 }, 2)).toBe(true);
    });

    it('should return true for adjacent vertical match', () => {
      const board = ['A', 'B', 'A', 'B'];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 1, col: 0 }, 2)).toBe(true);
    });

    it('should return true for same row with clear path', () => {
      const board: (string | null)[] = ['A', null, null, 'A'];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 0, col: 3 }, 4)).toBe(true);
    });

    it('should return true for same col with clear path', () => {
      const board: (string | null)[] = [
        'A', 'B',
        null, 'C',
        null, 'D',
        'A', 'E',
      ];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 3, col: 0 }, 2)).toBe(true);
    });

    it('should return false when blocked by non-null tile in same row', () => {
      const board: (string | null)[] = ['A', 'X', null, 'A'];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 0, col: 3 }, 4)).toBe(false);
    });

    it('should return false when blocked by non-null tile in same col', () => {
      const board: (string | null)[] = [
        'A', 'B',
        'X', 'C',
        null, 'D',
        'A', 'E',
      ];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 3, col: 0 }, 2)).toBe(false);
    });

    it('should return false for different tiles', () => {
      const board = ['A', 'B', 'C', 'D'];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 0, col: 1 }, 2)).toBe(false);
    });

    it('should return false for null cells', () => {
      const board: (string | null)[] = [null, 'A', 'B', 'C'];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 0, col: 1 }, 2)).toBe(false);
    });

    it('should return false for same cell', () => {
      const board = ['A', 'B', 'C', 'D'];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 0, col: 0 }, 2)).toBe(false);
    });

    it('should return false for diagonal (not same row/col, not adjacent)', () => {
      const board = ['A', 'B', 'C', 'A'];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 1, col: 1 }, 2)).toBe(false);
    });
  });

  describe('removeMatch', () => {
    it('should set matched positions to null', () => {
      const board = ['A', 'A', 'B', 'B'];
      const newBoard = removeMatch(board, { row: 0, col: 0 }, { row: 0, col: 1 }, 2);
      expect(newBoard[0]).toBe(null);
      expect(newBoard[1]).toBe(null);
      expect(newBoard[2]).toBe('B');
      expect(newBoard[3]).toBe('B');
    });

    it('should not mutate original board', () => {
      const board = ['A', 'A', 'B', 'B'];
      removeMatch(board, { row: 0, col: 0 }, { row: 0, col: 1 }, 2);
      expect(board[0]).toBe('A');
      expect(board[1]).toBe('A');
    });
  });

  describe('findHint', () => {
    it('should return valid pair for board with matches', () => {
      const board = ['A', 'A', 'B', 'B'];
      const hint = findHint(board, 2, 2);
      expect(hint).not.toBeNull();
      expect(canMatch(board, hint!.pos1, hint!.pos2, 2)).toBe(true);
    });

    it('should return null for dead board (no valid matches)', () => {
      const board: (string | null)[] = [
        'A', 'B',
        'B', 'A',
      ];
      const hint = findHint(board, 2, 2);
      expect(hint).toBeNull();
    });

    it('should return null for empty board', () => {
      const board: (string | null)[] = [null, null, null, null];
      const hint = findHint(board, 2, 2);
      expect(hint).toBeNull();
    });

    it('should find match for same row with clear path', () => {
      const board: (string | null)[] = ['A', null, null, 'A'];
      const hint = findHint(board, 1, 4);
      expect(hint).not.toBeNull();
    });
  });

  describe('shuffleBoard', () => {
    it('should preserve multiset of remaining tiles', () => {
      const board: (string | null)[] = ['A', 'A', 'B', 'B', null, null];
      const shuffled = shuffleBoard(board, 'shuffle-seed');
      
      const originalTiles = board.filter(t => t !== null).sort();
      const shuffledTiles = shuffled.filter(t => t !== null).sort();
      expect(shuffledTiles).toEqual(originalTiles);
    });

    it('should keep null positions null', () => {
      const board: (string | null)[] = ['A', null, 'B', null, 'A', 'B'];
      const shuffled = shuffleBoard(board, 'shuffle-seed');
      
      expect(shuffled[1]).toBe(null);
      expect(shuffled[3]).toBe(null);
    });

    it('should be deterministic with same seed', () => {
      const board: (string | null)[] = ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D'];
      const shuffled1 = shuffleBoard(board, 'same-seed');
      const shuffled2 = shuffleBoard(board, 'same-seed');
      expect(shuffled1).toEqual(shuffled2);
    });
  });

  describe('checkGameComplete', () => {
    it('should return true for all null board', () => {
      const board: (string | null)[] = [null, null, null, null];
      expect(checkGameComplete(board)).toBe(true);
    });

    it('should return false for board with tiles', () => {
      const board: (string | null)[] = ['A', null, null, 'A'];
      expect(checkGameComplete(board)).toBe(false);
    });
  });

  describe('calculateScore', () => {
    it('should calculate basic score without penalties', () => {
      const score = calculateScore({
        matchedPairs: 8,
        baseScore: 10,
        combo: 0,
        timeRemainingSeconds: 0,
        hintsUsed: 0,
        shufflesUsed: 0,
        hintPenalty: 10,
        shufflePenalty: 20,
      });
      expect(score).toBe(80);
    });

    it('should apply combo multiplier', () => {
      const score = calculateScore({
        matchedPairs: 10,
        baseScore: 10,
        combo: 5,
        timeRemainingSeconds: 0,
        hintsUsed: 0,
        shufflesUsed: 0,
        hintPenalty: 10,
        shufflePenalty: 20,
      });
      expect(score).toBe(150);
    });

    it('should cap combo multiplier at 2.0', () => {
      const score = calculateScore({
        matchedPairs: 10,
        baseScore: 10,
        combo: 20,
        timeRemainingSeconds: 0,
        hintsUsed: 0,
        shufflesUsed: 0,
        hintPenalty: 10,
        shufflePenalty: 20,
      });
      expect(score).toBe(200);
    });

    it('should add time bonus', () => {
      const score = calculateScore({
        matchedPairs: 8,
        baseScore: 10,
        combo: 0,
        timeRemainingSeconds: 30,
        hintsUsed: 0,
        shufflesUsed: 0,
        hintPenalty: 10,
        shufflePenalty: 20,
      });
      expect(score).toBe(140);
    });

    it('should apply hint penalty', () => {
      const score = calculateScore({
        matchedPairs: 8,
        baseScore: 10,
        combo: 0,
        timeRemainingSeconds: 0,
        hintsUsed: 3,
        shufflesUsed: 0,
        hintPenalty: 10,
        shufflePenalty: 20,
      });
      expect(score).toBe(50);
    });

    it('should apply shuffle penalty', () => {
      const score = calculateScore({
        matchedPairs: 8,
        baseScore: 10,
        combo: 0,
        timeRemainingSeconds: 0,
        hintsUsed: 0,
        shufflesUsed: 2,
        hintPenalty: 10,
        shufflePenalty: 20,
      });
      expect(score).toBe(40);
    });

    it('should clamp score to minimum 0', () => {
      const score = calculateScore({
        matchedPairs: 1,
        baseScore: 10,
        combo: 0,
        timeRemainingSeconds: 0,
        hintsUsed: 3,
        shufflesUsed: 2,
        hintPenalty: 10,
        shufflePenalty: 20,
      });
      expect(score).toBe(0);
    });

    it('should round to integer', () => {
      const score = calculateScore({
        matchedPairs: 3,
        baseScore: 10,
        combo: 1,
        timeRemainingSeconds: 0,
        hintsUsed: 0,
        shufflesUsed: 0,
        hintPenalty: 10,
        shufflePenalty: 20,
      });
      expect(score).toBe(33);
    });
  });
});
