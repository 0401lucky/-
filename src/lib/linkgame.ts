import seedrandom from 'seedrandom';
import type { LinkGameDifficulty, LinkGameDifficultyConfig, LinkGamePosition } from './types/game';

// Fruit-themed tile IDs (emojis)
export const LINKGAME_TILE_IDS = [
  '🍎', '🍊', '🍋', '🍇', '🍓', '🍒', '🍑', '🥝',
  '🍌', '🍉', '🥭', '🍍', '🫐', '🍈', '🍐', '🥥',
];

export const LINKGAME_TILE_TYPE_COUNT: Record<LinkGameDifficulty, number> = {
  easy: 4,
  normal: 6,
  hard: 8,
};

export const LINKGAME_DIFFICULTY_CONFIG: Record<LinkGameDifficulty, LinkGameDifficultyConfig> = {
  easy: {
    rows: 4,
    cols: 4,
    pairs: 8,
    baseScore: 10,
    timeLimit: 120,
    hintLimit: 3,
    shuffleLimit: 2,
    hintPenalty: 10,
    shufflePenalty: 20,
  },
  normal: {
    rows: 6,
    cols: 6,
    pairs: 18,
    baseScore: 15,
    timeLimit: 150,
    hintLimit: 3,
    shuffleLimit: 2,
    hintPenalty: 10,
    shufflePenalty: 20,
  },
  hard: {
    rows: 8,
    cols: 8,
    pairs: 32,
    baseScore: 20,
    timeLimit: 180,
    hintLimit: 3,
    shuffleLimit: 2,
    hintPenalty: 10,
    shufflePenalty: 20,
  },
};

type Rng = () => number;

/**
 * Fisher-Yates shuffle using provided RNG
 */
function shuffleArray<T>(arr: T[], rng: Rng): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Generate a deterministic tile layout for the game board.
 * Returns a 1D array (row-major) of tile IDs, each tile appears in pairs.
 */
export function generateTileLayout(difficulty: LinkGameDifficulty, seed: string): string[] {
  const config = LINKGAME_DIFFICULTY_CONFIG[difficulty];
  const totalCells = config.rows * config.cols;
  const pairs = config.pairs;
  const tileTypeCount = LINKGAME_TILE_TYPE_COUNT[difficulty];

  if (pairs !== totalCells / 2) {
    throw new Error(`Invalid config: pairs (${pairs}) must equal totalCells/2 (${totalCells / 2})`);
  }

  const rng = seedrandom(seed);

  const tiles: string[] = [];
  for (let i = 0; i < pairs; i++) {
    const tileId = LINKGAME_TILE_IDS[i % tileTypeCount];
    tiles.push(tileId, tileId);
  }

  return shuffleArray(tiles, rng);
}

/**
 * Convert 2D position to 1D index (row-major order)
 */
export function indexOf(pos: LinkGamePosition, cols: number): number {
  return pos.row * cols + pos.col;
}

/**
 * Convert 1D index to 2D position
 */
export function positionOf(index: number, cols: number): LinkGamePosition {
  return {
    row: Math.floor(index / cols),
    col: index % cols,
  };
}

/**
 * Get tile at position from board
 */
export function getTile(board: (string | null)[], pos: LinkGamePosition, cols: number): string | null {
  const idx = indexOf(pos, cols);
  if (idx < 0 || idx >= board.length) return null;
  return board[idx];
}

/**
 * Check if two positions are adjacent (up/down/left/right)
 */
function areAdjacent(pos1: LinkGamePosition, pos2: LinkGamePosition): boolean {
  const dr = Math.abs(pos1.row - pos2.row);
  const dc = Math.abs(pos1.col - pos2.col);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

/**
 * Check if path between two positions in same row/col is clear (all nulls)
 */
function hasClearPath(
  board: (string | null)[],
  pos1: LinkGamePosition,
  pos2: LinkGamePosition,
  cols: number
): boolean {
  // Must be same row or same col
  if (pos1.row !== pos2.row && pos1.col !== pos2.col) {
    return false;
  }

  if (pos1.row === pos2.row) {
    // Same row - check horizontal path
    const minCol = Math.min(pos1.col, pos2.col);
    const maxCol = Math.max(pos1.col, pos2.col);
    for (let c = minCol + 1; c < maxCol; c++) {
      const idx = pos1.row * cols + c;
      if (board[idx] !== null) return false;
    }
    return true;
  } else {
    // Same col - check vertical path
    const minRow = Math.min(pos1.row, pos2.row);
    const maxRow = Math.max(pos1.row, pos2.row);
    for (let r = minRow + 1; r < maxRow; r++) {
      const idx = r * cols + pos1.col;
      if (board[idx] !== null) return false;
    }
    return true;
  }
}

/**
 * Check if two positions can be matched.
 * Rules:
 * - Both positions must have the same non-null tile
 * - Positions must be different
 * - Either adjacent OR same row/col with all intermediate cells empty
 */
export function canMatch(
  board: (string | null)[],
  pos1: LinkGamePosition,
  pos2: LinkGamePosition,
  cols: number
): boolean {
  // Same position check
  if (pos1.row === pos2.row && pos1.col === pos2.col) {
    return false;
  }

  const tile1 = getTile(board, pos1, cols);
  const tile2 = getTile(board, pos2, cols);

  // Both must be non-null and same tile
  if (tile1 === null || tile2 === null || tile1 !== tile2) {
    return false;
  }

  // Check if adjacent
  if (areAdjacent(pos1, pos2)) {
    return true;
  }

  // Check if same row/col with clear path
  return hasClearPath(board, pos1, pos2, cols);
}

/**
 * Remove matched tiles from board.
 * Returns a new board with positions set to null.
 * Does NOT mutate the original board.
 */
export function removeMatch(
  board: (string | null)[],
  pos1: LinkGamePosition,
  pos2: LinkGamePosition,
  cols: number
): (string | null)[] {
  const newBoard = [...board];
  const idx1 = indexOf(pos1, cols);
  const idx2 = indexOf(pos2, cols);
  newBoard[idx1] = null;
  newBoard[idx2] = null;
  return newBoard;
}

/**
 * Find a valid match (hint) on the board.
 * Returns positions of a matchable pair, or null if none exists (dead board).
 */
export function findHint(
  board: (string | null)[],
  _rows: number,
  cols: number
): { pos1: LinkGamePosition; pos2: LinkGamePosition } | null {
  const tilePositions: Map<string, LinkGamePosition[]> = new Map();

  for (let i = 0; i < board.length; i++) {
    const tile = board[i];
    if (tile !== null) {
      const pos = positionOf(i, cols);
      if (!tilePositions.has(tile)) {
        tilePositions.set(tile, []);
      }
      tilePositions.get(tile)!.push(pos);
    }
  }

  // For each tile type, check all pairs
  for (const positions of tilePositions.values()) {
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        if (canMatch(board, positions[i], positions[j], cols)) {
          return { pos1: positions[i], pos2: positions[j] };
        }
      }
    }
  }

  return null;
}

/**
 * Shuffle the board while preserving the multiset of remaining tiles.
 * Null positions remain null.
 * Returns a new shuffled board.
 */
export function shuffleBoard(
  board: (string | null)[],
  seed?: string
): (string | null)[] {
  const rng = seed ? seedrandom(seed) : seedrandom(Date.now().toString());

  // Collect non-null tiles and their original indices
  const nonNullTiles: string[] = [];
  const nonNullIndices: number[] = [];

  for (let i = 0; i < board.length; i++) {
    if (board[i] !== null) {
      nonNullTiles.push(board[i]!);
      nonNullIndices.push(i);
    }
  }

  // Shuffle the tiles
  const shuffledTiles = shuffleArray(nonNullTiles, rng);

  // Create new board with shuffled tiles
  const newBoard: (string | null)[] = new Array(board.length).fill(null);
  for (let i = 0; i < nonNullIndices.length; i++) {
    newBoard[nonNullIndices[i]] = shuffledTiles[i];
  }

  return newBoard;
}

/**
 * Check if the game is complete (all tiles removed)
 */
export function checkGameComplete(board: (string | null)[]): boolean {
  return board.every((tile) => tile === null);
}

/**
 * Score calculation parameters
 */
export interface ScoreParams {
  matchedPairs: number;
  baseScore: number;
  combo: number;
  timeRemainingSeconds: number;
  hintsUsed: number;
  shufflesUsed: number;
  hintPenalty: number;
  shufflePenalty: number;
}

/**
 * Calculate final score based on game performance.
 * Formula:
 * - comboMultiplier = min(2.0, 1 + combo * 0.1)
 * - timeBonus = timeRemainingSeconds * 2
 * - finalScore = matchedPairs * baseScore * comboMultiplier + timeBonus - hintsUsed * hintPenalty - shufflesUsed * shufflePenalty
 * - Clamped to >= 0 and rounded to integer
 */
export function calculateScore(params: ScoreParams): number {
  const {
    matchedPairs,
    baseScore,
    combo,
    timeRemainingSeconds,
    hintsUsed,
    shufflesUsed,
    hintPenalty,
    shufflePenalty,
  } = params;

  const comboMultiplier = Math.min(2.0, 1 + combo * 0.1);
  const timeBonus = timeRemainingSeconds * 2;
  const rawScore =
    matchedPairs * baseScore * comboMultiplier +
    timeBonus -
    hintsUsed * hintPenalty -
    shufflesUsed * shufflePenalty;

  return Math.round(Math.max(0, rawScore));
}
