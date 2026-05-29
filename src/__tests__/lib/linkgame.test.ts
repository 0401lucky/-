import { describe, it, expect } from 'vitest';
import {
  LINKGAME_TILE_IDS,
  LINKGAME_DIFFICULTY_CONFIG,
  LINKGAME_TILE_TYPE_COUNT,
  LINKGAME_POINT_REWARD_PERCENT,
  LINKGAME_HARD_DEADLOCK_REWARD_PERCENT,
  LINKGAME_HARD_COMPLETION_REWARD_PERCENT,
  LINKGAME_HARD_TIMEOUT_REWARD_PERCENT,
  LINKGAME_HARD_DEADLOCK_RATE_BY_STAGE,
  LINKGAME_HARD_MAX_DEADLOCK_RATE,
  LINKGAME_HARD_WIN_OUTCOME,
  LINKGAME_HARD_LOSS_OUTCOMES,
  generateTileLayout,
  shouldGenerateHardStageDeadlock,
  getHardDeadlockRateForStage,
  getPlannedHardDeadlockStage,
  getStackExposureStages,
  indexOf,
  positionOf,
  indexOfPosition,
  positionOfIndex,
  getTile,
  canMatch,
  canMatchByConfig,
  canStackMatch,
  removeMatch,
  removeMatchByConfig,
  canTripleMatch,
  removeTripleMatch,
  findHint,
  findHintByConfig,
  getLinkGamePointRewardPercent,
  getActiveTileCount,
  isActivePosition,
  isStack3DConfig,
  isStackTileBlocked,
  isStackTileSelectable,
  checkGameComplete,
  calculateScore,
  calculateLinkGamePointReward,
  getLinkGameSettlementResult,
  isHardModeWin,
  calculateHardModeWinRate,
  findMatchPath,
} from '@/lib/linkgame';

describe('linkgame', () => {
  describe('LINKGAME_TILE_IDS', () => {
    it('should have enough tile IDs for sparse hard boards', () => {
      expect(LINKGAME_TILE_IDS.length).toBeGreaterThanOrEqual(24);
    });
  });

  describe('LINKGAME_DIFFICULTY_CONFIG', () => {
    it('should have configs for easy, normal, hard', () => {
      expect(LINKGAME_DIFFICULTY_CONFIG.easy).toBeDefined();
      expect(LINKGAME_DIFFICULTY_CONFIG.normal).toBeDefined();
      expect(LINKGAME_DIFFICULTY_CONFIG.hard).toBeDefined();
    });

    it('easy should use the previous hard 2D scale', () => {
      const cfg = LINKGAME_DIFFICULTY_CONFIG.easy;
      expect(cfg.rows).toBe(8);
      expect(cfg.cols).toBe(8);
      expect(cfg.pairs).toBe(32);
      expect(cfg.baseScore).toBe(15);
      expect(cfg.timeLimit).toBe(180);
      expect(cfg.mode).toBe('classic2d');
      expect(cfg.rows * cfg.cols).toBe(cfg.pairs * 2);
    });

    it('normal should be the 2D middle difficulty', () => {
      const cfg = LINKGAME_DIFFICULTY_CONFIG.normal;
      expect(cfg.rows).toBe(8);
      expect(cfg.cols).toBe(10);
      expect(cfg.pairs).toBe(40);
      expect(cfg.baseScore).toBe(18);
      expect(cfg.timeLimit).toBe(210);
      expect(cfg.mode).toBe('classic2d');
    });

    it('hard should use a five-layer stack3d layout with 66 pairs', () => {
      const cfg = LINKGAME_DIFFICULTY_CONFIG.hard;
      expect(cfg.rows).toBe(8);
      expect(cfg.cols).toBe(8);
      expect(cfg.pairs).toBe(66);
      expect(cfg.baseScore).toBe(24);
      expect(cfg.timeLimit).toBe(300);
      expect(cfg.mode).toBe('stack3d');
      expect(cfg.depth).toBe(5);
      expect(getActiveTileCount(cfg)).toBe(132);
    });
  });

  describe('generateTileLayout', () => {
    it('should produce correct length for easy difficulty', () => {
      const layout = generateTileLayout('easy', 'test-seed');
      expect(layout.length).toBe(64);
    });

    it('should produce correct length for normal difficulty', () => {
      const layout = generateTileLayout('normal', 'test-seed');
      expect(layout.length).toBe(80);
    });

    it('should produce correct length for hard difficulty', () => {
      const layout = generateTileLayout('hard', 'test-seed');
      const cfg = LINKGAME_DIFFICULTY_CONFIG.hard;
      expect(layout.length).toBe(cfg.rows * cfg.cols * (cfg.depth ?? 1));
      expect(layout.filter((tile) => tile !== null)).toHaveLength(132);
    });

    it('should have each tile count as even (pairs)', () => {
      const layout = generateTileLayout('easy', 'test-seed');
      const counts = new Map<string, number>();
      for (const tile of layout) {
        if (tile === null) continue;
        counts.set(tile, (counts.get(tile) || 0) + 1);
      }
      for (const count of counts.values()) {
        expect(count % 2).toBe(0);
      }
    });

    it('hard should never create orphan cards, including planned deadlock boards', () => {
      for (let seedIndex = 0; seedIndex < 80; seedIndex++) {
        const layout = generateTileLayout('hard', `strict-pair-${seedIndex}`);
        const counts = new Map<string, number>();

        for (const tile of layout) {
          if (tile === null) continue;
          counts.set(tile, (counts.get(tile) ?? 0) + 1);
        }

        for (const count of counts.values()) {
          expect(count).toBeGreaterThanOrEqual(2);
          expect(count % 2).toBe(0);
        }
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

    it('easy should use only 8 tile types', () => {
      const layout = generateTileLayout('easy', 'type-count-test');
      const uniqueTiles = new Set(layout);
      expect(uniqueTiles.size).toBe(LINKGAME_TILE_TYPE_COUNT.easy);
      expect(uniqueTiles.size).toBe(8);
    });

    it('normal should use only 12 tile types', () => {
      const layout = generateTileLayout('normal', 'type-count-test');
      const uniqueTiles = new Set(layout);
      expect(uniqueTiles.size).toBe(LINKGAME_TILE_TYPE_COUNT.normal);
      expect(uniqueTiles.size).toBe(12);
    });

    it('hard should use configured tile types on active cells', () => {
      const layout = generateTileLayout('hard', 'type-count-test');
      const uniqueTiles = new Set(layout.filter((tile): tile is string => tile !== null));
      expect(uniqueTiles.size).toBe(LINKGAME_TILE_TYPE_COUNT.hard);
      expect(uniqueTiles.size).toBe(24);
    });

    it('should ensure at least one valid move exists', () => {
      const layout = generateTileLayout('easy', 'ensure-valid-move');
      const hint = findHint(layout, 8, 8);
      expect(hint).not.toBeNull();
    });

    it('hard should generate at least one stack3d match', () => {
      const config = LINKGAME_DIFFICULTY_CONFIG.hard;
      const layout = generateTileLayout('hard', 'ensure-stack-move');
      const hint = findHintByConfig(layout, config);
      expect(hint).not.toBeNull();
      expect(canStackMatch(layout, hint!.pos1, hint!.pos2, config)).toBe(true);
    });

    it('hard should increase planned deadlock rates as exposed stages get deeper', () => {
      expect(LINKGAME_HARD_DEADLOCK_RATE_BY_STAGE).toEqual([0, 0.025, 0.05, 0.1, 0]);
      expect(LINKGAME_HARD_MAX_DEADLOCK_RATE).toBe(0.1);
      expect(getHardDeadlockRateForStage(0)).toBe(0);
      expect(getHardDeadlockRateForStage(1)).toBe(0.025);
      expect(getHardDeadlockRateForStage(3)).toBe(0.1);
      expect(getHardDeadlockRateForStage(4)).toBe(0);

      let selected = 0;
      for (let i = 0; i < 1000; i++) {
        if (shouldGenerateHardStageDeadlock(`rate-${i}`, 3)) selected++;
      }

      expect(selected).toBeGreaterThanOrEqual(70);
      expect(selected).toBeLessThanOrEqual(130);
    });

    it('hard should not plan final-layer deadlocks because final cards must stay paired', () => {
      const config = LINKGAME_DIFFICULTY_CONFIG.hard;
      for (let i = 0; i < 300; i++) {
        const plannedStage = getPlannedHardDeadlockStage(`final-stage-guard-${i}`, config);
        expect(plannedStage).not.toBe((config.depth ?? 1) - 1);
      }
    });

    it('planned hard layouts should eventually run out of visible matches', () => {
      const config = LINKGAME_DIFFICULTY_CONFIG.hard;
      const seed = Array.from({ length: 200 }, (_, index) => `deadlock-prone-${index}`)
        .find((value) => getPlannedHardDeadlockStage(value, config) !== null);
      expect(seed).toBeDefined();

      let board = generateTileLayout('hard', seed!);
      let clearedPairs = 0;
      let hint = findHintByConfig(board, config);

      while (hint && clearedPairs < config.pairs) {
        board = removeMatchByConfig(board, hint.pos1, hint.pos2, config);
        clearedPairs++;
        hint = findHintByConfig(board, config);
      }

      expect(hint).toBeNull();
      expect(checkGameComplete(board)).toBe(false);
    });

    it('hard exposure stages should match the 8x8x5 stack pressure curve', () => {
      const stages = getStackExposureStages(LINKGAME_DIFFICULTY_CONFIG.hard);
      expect(stages.map((stage) => stage.length)).toEqual([64, 24, 20, 12, 12]);
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

    it('should convert stack3d positions with z axis', () => {
      const config = LINKGAME_DIFFICULTY_CONFIG.hard;
      const pos = { row: 2, col: 3, z: 1 };
      const index = indexOfPosition(pos, config);
      expect(index).toBe(1 * 8 * 8 + 2 * 8 + 3);
      expect(positionOfIndex(index, config)).toEqual(pos);
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
        'A', 'B', 'C',
        null, 'D', 'E',
        null, 'F', 'G',
        'A', 'H', 'I',
      ];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 3, col: 0 }, 3)).toBe(true);
    });

    it('should return true when blocked in same row but can go via border', () => {
      const board: (string | null)[] = ['A', 'X', null, 'A'];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 0, col: 3 }, 4)).toBe(true);
    });

    it('should return false when completely surrounded', () => {
      const board: (string | null)[] = [
        'X', 'X', 'X', 'X', 'X',
        'X', 'A', 'X', 'A', 'X',
        'X', 'X', 'X', 'X', 'X',
      ];
      expect(canMatch(board, { row: 1, col: 1 }, { row: 1, col: 3 }, 5)).toBe(false);
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

    it('should return true for 1-turn path through empty corner', () => {
      const board: (string | null)[] = [
        'A', null,
        'B', 'A',
      ];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 1, col: 1 }, 2)).toBe(true);
    });

    it('should return true for 2-turn path', () => {
      const board: (string | null)[] = [
        'A', 'X', 'X',
        null, null, null,
        'X', 'X', 'A',
      ];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 2, col: 2 }, 3)).toBe(true);
    });

    it('should return true for outside-border path (1x3 A B A)', () => {
      const board: (string | null)[] = ['A', 'B', 'A'];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 0, col: 2 }, 3)).toBe(true);
    });

    it('should return true for path going around via top border', () => {
      const board: (string | null)[] = [
        'A', 'X', 'A',
        'X', 'X', 'X',
      ];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 0, col: 2 }, 3)).toBe(true);
    });

    it('should return true for path going around via bottom border', () => {
      const board: (string | null)[] = [
        'X', 'X', 'X',
        'A', 'X', 'A',
      ];
      expect(canMatch(board, { row: 1, col: 0 }, { row: 1, col: 2 }, 3)).toBe(true);
    });

    it('should return true for path going around via left border', () => {
      const board: (string | null)[] = [
        'A', 'X',
        'X', 'X',
        'A', 'X',
      ];
      expect(canMatch(board, { row: 0, col: 0 }, { row: 2, col: 0 }, 2)).toBe(true);
    });
  });

  describe('findMatchPath', () => {
    it('should return path for adjacent tiles', () => {
      const board = ['A', 'A', 'B', 'B'];
      const path = findMatchPath(board, { row: 0, col: 0 }, { row: 0, col: 1 }, 2);
      expect(path).not.toBeNull();
      expect(path!.length).toBe(2);
      expect(path![0]).toEqual({ row: 0, col: 0 });
      expect(path![1]).toEqual({ row: 0, col: 1 });
    });

    it('should return path for 1-turn match', () => {
      const board: (string | null)[] = [
        'A', null,
        'B', 'A',
      ];
      const path = findMatchPath(board, { row: 0, col: 0 }, { row: 1, col: 1 }, 2);
      expect(path).not.toBeNull();
      expect(path!.length).toBe(3);
    });

    it('should return path for 2-turn match', () => {
      const board: (string | null)[] = [
        'A', 'X', 'X',
        null, null, null,
        'X', 'X', 'A',
      ];
      const path = findMatchPath(board, { row: 0, col: 0 }, { row: 2, col: 2 }, 3);
      expect(path).not.toBeNull();
      expect(path!.length).toBe(4);
    });

    it('should return path with virtual coordinates for border path', () => {
      const board: (string | null)[] = ['A', 'B', 'A'];
      const path = findMatchPath(board, { row: 0, col: 0 }, { row: 0, col: 2 }, 3);
      expect(path).not.toBeNull();
      const hasVirtualCoord = path!.some(p => p.row < 0 || p.row > 0 || p.col < 0 || p.col > 2);
      expect(hasVirtualCoord).toBe(true);
    });

    it('should return null for non-matching tiles', () => {
      const board = ['A', 'B', 'C', 'D'];
      const path = findMatchPath(board, { row: 0, col: 0 }, { row: 0, col: 1 }, 2);
      expect(path).toBeNull();
    });

    it('should return null for blocked path requiring 3+ turns', () => {
      const board: (string | null)[] = [
        'A', 'X', 'X', 'X',
        'X', 'X', 'X', 'X',
        'X', 'X', 'X', 'X',
        'X', 'X', 'X', 'A',
      ];
      const path = findMatchPath(board, { row: 0, col: 0 }, { row: 3, col: 3 }, 4);
      expect(path).toBeNull();
    });

    it('should correctly compute rows from board.length/cols for non-square boards', () => {
      const board: (string | null)[] = [
        'A', 'B', 'C', 'D', 'E', 'F',
        'A', 'B', 'C', 'D', 'E', 'F',
      ];
      const path = findMatchPath(board, { row: 0, col: 0 }, { row: 1, col: 0 }, 6);
      expect(path).not.toBeNull();
      expect(path!.length).toBe(2);
    });

    it('should return null for invalid board dimensions', () => {
      const board: (string | null)[] = ['A', 'A', 'B'];
      const path = findMatchPath(board, { row: 0, col: 0 }, { row: 0, col: 1 }, 2);
      expect(path).toBeNull();
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

  describe('stack3d rules', () => {
    const config = LINKGAME_DIFFICULTY_CONFIG.hard;
    const createBoard = () => new Array<string | null>(config.rows * config.cols * (config.depth ?? 1)).fill(null);
    const put = (board: (string | null)[], pos: { row: number; col: number; z: number }, tile: string) => {
      board[indexOfPosition(pos, config)] = tile;
    };

    it('should identify active and inactive tower cells', () => {
      expect(isStack3DConfig(config)).toBe(true);
      expect(isActivePosition(config, { row: 0, col: 1, z: 0 })).toBe(true);
      expect(isActivePosition(config, { row: 0, col: 0, z: 0 })).toBe(true);
      expect(isActivePosition(config, { row: 0, col: 0, z: 1 })).toBe(false);
      expect(isActivePosition(config, { row: 2, col: 2, z: 2 })).toBe(true);
      expect(isActivePosition(config, { row: 2, col: 3, z: 4 })).toBe(true);
    });

    it('should match adjacent same tiles on an unblocked layer', () => {
      const board = createBoard();
      const pos1 = { row: 2, col: 2, z: 2 };
      const pos2 = { row: 2, col: 3, z: 2 };
      put(board, pos1, 'A');
      put(board, pos2, 'A');

      expect(canStackMatch(board, pos1, pos2, config)).toBe(true);
      expect(canMatchByConfig(board, pos1, pos2, config)).toBe(true);

      const next = removeMatchByConfig(board, pos1, pos2, config);
      expect(next[indexOfPosition(pos1, config)]).toBe(null);
      expect(next[indexOfPosition(pos2, config)]).toBe(null);
    });

    it('should reject exact vertical stack matches because lower tile is not fully exposed', () => {
      const board = createBoard();
      const pos1 = { row: 2, col: 2, z: 1 };
      const pos2 = { row: 2, col: 2, z: 2 };
      put(board, pos1, 'A');
      put(board, pos2, 'A');

      expect(canStackMatch(board, pos1, pos2, config)).toBe(false);
    });

    it('should allow adjacent-layer matches when both tiles are fully exposed', () => {
      const board = createBoard();
      const pos1 = { row: 2, col: 2, z: 1 };
      const pos2 = { row: 2, col: 3, z: 2 };
      put(board, pos1, 'A');
      put(board, pos2, 'A');

      expect(canStackMatch(board, pos1, pos2, config)).toBe(true);
    });

    it('should match non-adjacent exposed same stack tiles', () => {
      const board = createBoard();
      const pos1 = { row: 2, col: 3, z: 4 };
      const pos2 = { row: 5, col: 4, z: 4 };
      put(board, pos1, 'A');
      put(board, pos2, 'A');

      expect(canStackMatch(board, pos1, pos2, config)).toBe(true);
    });

    it('should reject adjacent stack tiles with different icons', () => {
      const board = createBoard();
      const pos1 = { row: 2, col: 2, z: 2 };
      const pos2 = { row: 2, col: 3, z: 2 };
      put(board, pos1, 'A');
      put(board, pos2, 'B');

      expect(canStackMatch(board, pos1, pos2, config)).toBe(false);
    });

    it('should reject tiles blocked by upper layers', () => {
      const board = createBoard();
      const pos1 = { row: 2, col: 2, z: 0 };
      const pos2 = { row: 2, col: 3, z: 0 };
      put(board, pos1, 'A');
      put(board, pos2, 'A');
      put(board, { row: 2, col: 2, z: 1 }, 'B');

      expect(isStackTileBlocked(board, pos1, config)).toBe(true);
      expect(isStackTileSelectable(board, pos1, config)).toBe(false);
      expect(canStackMatch(board, pos1, pos2, config)).toBe(false);
    });
  });

  describe('findHint', () => {
    it('should return valid pair for board with matches', () => {
      const board = ['A', 'A', 'B', 'B'];
      const hint = findHint(board, 2, 2);
      expect(hint).not.toBeNull();
      expect(canMatch(board, hint!.pos1, hint!.pos2, 2)).toBe(true);
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

    it('should find match via border path', () => {
      const board: (string | null)[] = ['A', 'B', 'A'];
      const hint = findHint(board, 1, 3);
      expect(hint).not.toBeNull();
    });

    it('should find match with 2-turn path', () => {
      const board: (string | null)[] = [
        'A', 'X', 'X',
        null, null, null,
        'X', 'X', 'A',
      ];
      const hint = findHint(board, 3, 3);
      expect(hint).not.toBeNull();
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
    it('should calculate basic score', () => {
      const score = calculateScore({
        matchedPairs: 8,
        baseScore: 10,
        combo: 0,
        timeRemainingSeconds: 0,
      });
      expect(score).toBe(80);
    });

    it('should apply combo multiplier', () => {
      const score = calculateScore({
        matchedPairs: 10,
        baseScore: 10,
        combo: 5,
        timeRemainingSeconds: 0,
      });
      expect(score).toBe(150);
    });

    it('should cap combo multiplier at 1.5', () => {
      const score = calculateScore({
        matchedPairs: 10,
        baseScore: 10,
        combo: 20,
        timeRemainingSeconds: 0,
      });
      expect(score).toBe(150);
    });

    it('should add time bonus', () => {
      const score = calculateScore({
        matchedPairs: 8,
        baseScore: 10,
        combo: 0,
        timeRemainingSeconds: 30,
      });
      expect(score).toBe(110);
    });

    it('should ignore removed tool fields when old callers pass them', () => {
      const score = calculateScore({
        matchedPairs: 8,
        baseScore: 10,
        combo: 0,
        timeRemainingSeconds: 0,
        hintsUsed: 99,
        shufflesUsed: 99,
        hintPenalty: 10,
        shufflePenalty: 20,
      } as Parameters<typeof calculateScore>[0] & {
        hintsUsed: number;
        shufflesUsed: number;
        hintPenalty: number;
        shufflePenalty: number;
      });
      expect(score).toBe(80);
    });

    it('should clamp score to minimum 0', () => {
      const score = calculateScore({
        matchedPairs: 1,
        baseScore: -10,
        combo: 0,
        timeRemainingSeconds: 0,
      });
      expect(score).toBe(0);
    });

    it('should round to integer', () => {
      const score = calculateScore({
        matchedPairs: 3,
        baseScore: 10,
        combo: 1,
        timeRemainingSeconds: 0,
      });
      expect(score).toBe(33);
    });

    it('hard mode should ignore combo and use pressure scoring', () => {
      const baseParams = {
        matchedPairs: 10,
        baseScore: 24,
        timeRemainingSeconds: 100,
        difficulty: 'hard' as const,
        totalPairs: 66,
        outcome: 'timeout' as const,
      };

      const noComboScore = calculateScore({
        ...baseParams,
        combo: 0,
      });
      const highComboScore = calculateScore({
        ...baseParams,
        combo: 20,
      });

      expect(highComboScore).toBe(noComboScore);
      expect(noComboScore).toBeGreaterThan(10 * 24);
    });

    it('hard mode should add outcome bonuses without combo scoring', () => {
      const shared = {
        matchedPairs: 20,
        baseScore: 24,
        combo: 0,
        timeRemainingSeconds: 120,
        difficulty: 'hard' as const,
        totalPairs: 66,
      };

      const timeoutScore = calculateScore({
        ...shared,
        outcome: 'timeout',
      });
      const deadlockScore = calculateScore({
        ...shared,
        outcome: 'deadlock',
      });
      const completedScore = calculateScore({
        ...shared,
        outcome: 'completed',
      });

      expect(deadlockScore).toBeGreaterThan(timeoutScore);
      expect(completedScore).toBeGreaterThan(deadlockScore);
    });
  });

  describe('calculateLinkGamePointReward', () => {
    it('should calculate default point reward as 1 percent rounded down', () => {
      expect(LINKGAME_POINT_REWARD_PERCENT).toBe(1);
      expect(calculateLinkGamePointReward(99)).toBe(0);
      expect(calculateLinkGamePointReward(100)).toBe(1);
      expect(calculateLinkGamePointReward(999)).toBe(9);
      expect(calculateLinkGamePointReward(1000)).toBe(10);
    });

    it('should use special hard-mode reward rates for deadlock and completion', () => {
      expect(LINKGAME_HARD_DEADLOCK_REWARD_PERCENT).toBe(10);
      expect(LINKGAME_HARD_COMPLETION_REWARD_PERCENT).toBe(20);
      expect(LINKGAME_HARD_TIMEOUT_REWARD_PERCENT).toBe(1);
      expect(getLinkGamePointRewardPercent('hard', 'deadlock')).toBe(10);
      expect(getLinkGamePointRewardPercent('hard', 'completed')).toBe(20);
      expect(getLinkGamePointRewardPercent('hard', 'timeout')).toBe(1);
      expect(getLinkGamePointRewardPercent('normal', 'completed')).toBe(1);
      expect(calculateLinkGamePointReward(999, 'hard', 'deadlock')).toBe(99);
      expect(calculateLinkGamePointReward(1000, 'hard', 'completed')).toBe(200);
      expect(calculateLinkGamePointReward(1000, 'hard', 'timeout')).toBe(10);
      expect(calculateLinkGamePointReward(1000, 'easy', 'completed')).toBe(10);
    });
  });

  describe('hard settlement result helpers', () => {
    it('should define hard win and loss outcomes for win-rate calculation', () => {
      expect(LINKGAME_HARD_WIN_OUTCOME).toBe('completed');
      expect(LINKGAME_HARD_LOSS_OUTCOMES).toEqual(['deadlock', 'timeout']);
      expect(getLinkGameSettlementResult(true, 'completed')).toBe('win');
      expect(getLinkGameSettlementResult(false, 'deadlock')).toBe('loss');
      expect(getLinkGameSettlementResult(false, 'timeout')).toBe('loss');
    });

    it('should calculate hard win rate from settled records', () => {
      const stats = calculateHardModeWinRate([
        { difficulty: 'hard', completed: true, outcome: 'completed' },
        { difficulty: 'hard', completed: false, outcome: 'deadlock' },
        { difficulty: 'hard', completed: false, outcome: 'timeout' },
        { difficulty: 'normal', completed: true, outcome: 'completed' },
      ]);

      expect(isHardModeWin({ difficulty: 'hard', completed: true, outcome: 'completed' })).toBe(true);
      expect(isHardModeWin({ difficulty: 'hard', completed: false, outcome: 'deadlock' })).toBe(false);
      expect(stats).toEqual({
        total: 3,
        wins: 1,
        losses: 2,
        winRate: 1 / 3,
      });
    });
  });

  describe('canTripleMatch', () => {
    it('should return true when all 3 pairs can connect', () => {
      const board: (string | null)[] = [
        'A', null, 'A',
        null, null, null,
        'A', null, 'B',
      ];
      const pos1 = { row: 0, col: 0 };
      const pos2 = { row: 0, col: 2 };
      const pos3 = { row: 2, col: 0 };
      expect(canTripleMatch(board, pos1, pos2, pos3, 3)).toBe(true);
    });

    it('should return false when tiles are different types', () => {
      const board: (string | null)[] = [
        'A', null, 'A',
        null, null, null,
        'B', null, 'C',
      ];
      const pos1 = { row: 0, col: 0 };
      const pos2 = { row: 0, col: 2 };
      const pos3 = { row: 2, col: 0 };
      expect(canTripleMatch(board, pos1, pos2, pos3, 3)).toBe(false);
    });

    it('should return false when one pair cannot connect', () => {
      const board: (string | null)[] = [
        'A', 'X', 'A',
        'X', 'X', 'X',
        'A', 'X', 'B',
      ];
      const pos1 = { row: 0, col: 0 };
      const pos2 = { row: 0, col: 2 };
      const pos3 = { row: 2, col: 0 };
      expect(canTripleMatch(board, pos1, pos2, pos3, 3)).toBe(false);
    });

    it('should return false when any tile is null', () => {
      const board: (string | null)[] = [
        'A', null, 'A',
        null, null, null,
        null, null, 'B',
      ];
      const pos1 = { row: 0, col: 0 };
      const pos2 = { row: 0, col: 2 };
      const pos3 = { row: 2, col: 0 };
      expect(canTripleMatch(board, pos1, pos2, pos3, 3)).toBe(false);
    });
  });

  describe('removeTripleMatch', () => {
    it('should set all 3 positions to null', () => {
      const board: (string | null)[] = [
        'A', 'B', 'A',
        'C', 'D', 'E',
        'A', 'F', 'G',
      ];
      const pos1 = { row: 0, col: 0 };
      const pos2 = { row: 0, col: 2 };
      const pos3 = { row: 2, col: 0 };
      const newBoard = removeTripleMatch(board, pos1, pos2, pos3, 3);
      expect(newBoard[0]).toBe(null);
      expect(newBoard[2]).toBe(null);
      expect(newBoard[6]).toBe(null);
      expect(newBoard[1]).toBe('B');
      expect(newBoard[4]).toBe('D');
    });

    it('should not mutate original board', () => {
      const board: (string | null)[] = ['A', 'A', 'A', 'B'];
      const pos1 = { row: 0, col: 0 };
      const pos2 = { row: 0, col: 1 };
      const pos3 = { row: 0, col: 2 };
      removeTripleMatch(board, pos1, pos2, pos3, 4);
      expect(board[0]).toBe('A');
      expect(board[1]).toBe('A');
      expect(board[2]).toBe('A');
    });
  });
});
