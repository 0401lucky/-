import seedrandom from 'seedrandom';
import type { LinkGameDifficulty, LinkGameDifficultyConfig, LinkGamePosition } from './types/game';

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

const MAX_SHUFFLE_ATTEMPTS = 100;

function shuffleArray<T>(arr: T[], rng: Rng): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function inferDimensions(boardLength: number): { rows: number; cols: number } {
  if (boardLength === 16) return { rows: 4, cols: 4 };
  if (boardLength === 36) return { rows: 6, cols: 6 };
  if (boardLength === 64) return { rows: 8, cols: 8 };

  const side = Math.sqrt(boardLength);
  if (Number.isInteger(side)) {
    return { rows: side, cols: side };
  }

  for (let c = Math.ceil(Math.sqrt(boardLength)); c <= boardLength; c++) {
    if (boardLength % c === 0) {
      return { rows: boardLength / c, cols: c };
    }
  }

  return { rows: 1, cols: boardLength };
}

export function indexOf(pos: LinkGamePosition, cols: number): number {
  return pos.row * cols + pos.col;
}

export function positionOf(index: number, cols: number): LinkGamePosition {
  return {
    row: Math.floor(index / cols),
    col: index % cols,
  };
}

export function getTile(board: (string | null)[], pos: LinkGamePosition, cols: number): string | null {
  const idx = indexOf(pos, cols);
  if (idx < 0 || idx >= board.length) return null;
  return board[idx];
}

function isEmptyInPaddedGrid(
  board: (string | null)[],
  rows: number,
  cols: number,
  pr: number,
  pc: number,
  startPr: number,
  startPc: number,
  endPr: number,
  endPc: number
): boolean {
  if (pr < 0 || pr > rows + 1 || pc < 0 || pc > cols + 1) return false;
  if (pr === 0 || pr === rows + 1 || pc === 0 || pc === cols + 1) return true;
  if ((pr === startPr && pc === startPc) || (pr === endPr && pc === endPc)) return true;
  const origRow = pr - 1;
  const origCol = pc - 1;
  return board[origRow * cols + origCol] === null;
}

function isSegmentClearPadded(
  board: (string | null)[],
  rows: number,
  cols: number,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  startPr: number,
  startPc: number,
  endPr: number,
  endPc: number
): boolean {
  if (r1 === r2) {
    const minC = Math.min(c1, c2);
    const maxC = Math.max(c1, c2);
    for (let c = minC; c <= maxC; c++) {
      if (!isEmptyInPaddedGrid(board, rows, cols, r1, c, startPr, startPc, endPr, endPc)) return false;
    }
    return true;
  } else if (c1 === c2) {
    const minR = Math.min(r1, r2);
    const maxR = Math.max(r1, r2);
    for (let r = minR; r <= maxR; r++) {
      if (!isEmptyInPaddedGrid(board, rows, cols, r, c1, startPr, startPc, endPr, endPc)) return false;
    }
    return true;
  }
  return false;
}

function paddedToVirtual(pr: number, pc: number): LinkGamePosition {
  return { row: pr - 1, col: pc - 1 };
}

function compactPath(path: LinkGamePosition[]): LinkGamePosition[] {
  if (path.length <= 2) return path;

  const result: LinkGamePosition[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const prev = result[result.length - 1];
    const curr = path[i];

    if (prev.row === curr.row && prev.col === curr.col) continue;

    if (result.length >= 2) {
      const prevPrev = result[result.length - 2];
      const isColinear =
        (prevPrev.row === prev.row && prev.row === curr.row) ||
        (prevPrev.col === prev.col && prev.col === curr.col);
      if (isColinear) {
        result[result.length - 1] = curr;
        continue;
      }
    }

    result.push(curr);
  }

  return result;
}

/**
 * Find a path between two tiles with at most 2 turns.
 * Returns path points in virtual coordinates (row/col may be -1..rows or cols for border).
 * Returns null if no valid path exists.
 */
export function findMatchPath(
  board: (string | null)[],
  pos1: LinkGamePosition,
  pos2: LinkGamePosition,
  cols: number
): LinkGamePosition[] | null {
  if (pos1.row === pos2.row && pos1.col === pos2.col) return null;

  const tile1 = getTile(board, pos1, cols);
  const tile2 = getTile(board, pos2, cols);
  if (tile1 === null || tile2 === null || tile1 !== tile2) return null;

  const rows = Math.floor(board.length / cols);
  if (rows <= 0 || rows * cols !== board.length) {
    return null;
  }

  const pr1 = pos1.row + 1;
  const pc1 = pos1.col + 1;
  const pr2 = pos2.row + 1;
  const pc2 = pos2.col + 1;

  const check = (r1: number, c1: number, r2: number, c2: number) =>
    isSegmentClearPadded(board, rows, cols, r1, c1, r2, c2, pr1, pc1, pr2, pc2);

  if ((pr1 === pr2 || pc1 === pc2) && check(pr1, pc1, pr2, pc2)) {
    return compactPath([paddedToVirtual(pr1, pc1), paddedToVirtual(pr2, pc2)]);
  }

  if (check(pr1, pc1, pr1, pc2) && check(pr1, pc2, pr2, pc2)) {
    return compactPath([
      paddedToVirtual(pr1, pc1),
      paddedToVirtual(pr1, pc2),
      paddedToVirtual(pr2, pc2),
    ]);
  }
  if (check(pr1, pc1, pr2, pc1) && check(pr2, pc1, pr2, pc2)) {
    return compactPath([
      paddedToVirtual(pr1, pc1),
      paddedToVirtual(pr2, pc1),
      paddedToVirtual(pr2, pc2),
    ]);
  }

  for (let midR = 0; midR <= rows + 1; midR++) {
    if (midR === pr1 || midR === pr2) continue;
    if (check(pr1, pc1, midR, pc1) && check(midR, pc1, midR, pc2) && check(midR, pc2, pr2, pc2)) {
      return compactPath([
        paddedToVirtual(pr1, pc1),
        paddedToVirtual(midR, pc1),
        paddedToVirtual(midR, pc2),
        paddedToVirtual(pr2, pc2),
      ]);
    }
  }

  for (let midC = 0; midC <= cols + 1; midC++) {
    if (midC === pc1 || midC === pc2) continue;
    if (check(pr1, pc1, pr1, midC) && check(pr1, midC, pr2, midC) && check(pr2, midC, pr2, pc2)) {
      return compactPath([
        paddedToVirtual(pr1, pc1),
        paddedToVirtual(pr1, midC),
        paddedToVirtual(pr2, midC),
        paddedToVirtual(pr2, pc2),
      ]);
    }
  }

  return null;
}

export function canMatch(
  board: (string | null)[],
  pos1: LinkGamePosition,
  pos2: LinkGamePosition,
  cols: number
): boolean {
  return findMatchPath(board, pos1, pos2, cols) !== null;
}

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

function findHintInternal(
  board: (string | null)[],
  rows: number,
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

export function findHint(
  board: (string | null)[],
  rows: number,
  cols: number
): { pos1: LinkGamePosition; pos2: LinkGamePosition } | null {
  return findHintInternal(board, rows, cols);
}

export function shuffleBoard(
  board: (string | null)[],
  seed?: string
): (string | null)[] {
  const { rows, cols } = inferDimensions(board.length);

  const nonNullTiles: string[] = [];
  const nonNullIndices: number[] = [];

  for (let i = 0; i < board.length; i++) {
    if (board[i] !== null) {
      nonNullTiles.push(board[i]!);
      nonNullIndices.push(i);
    }
  }

  if (nonNullTiles.length === 0) {
    return [...board];
  }

  let lastBoard: (string | null)[] = [...board];

  for (let attempt = 0; attempt < MAX_SHUFFLE_ATTEMPTS; attempt++) {
    const rng = seed
      ? seedrandom(`${seed}-shuffle-${attempt}`)
      : seedrandom(`${Date.now()}-${attempt}`);

    const shuffledTiles = shuffleArray(nonNullTiles, rng);

    const newBoard: (string | null)[] = new Array(board.length).fill(null);
    for (let i = 0; i < nonNullIndices.length; i++) {
      newBoard[nonNullIndices[i]] = shuffledTiles[i];
    }
    lastBoard = newBoard;

    const hint = findHintInternal(newBoard, rows, cols);
    if (hint !== null) {
      return newBoard;
    }
  }

  return lastBoard;
}

export function generateTileLayout(difficulty: LinkGameDifficulty, seed: string): string[] {
  const config = LINKGAME_DIFFICULTY_CONFIG[difficulty];
  const { rows, cols, pairs } = config;
  const totalCells = rows * cols;
  const tileTypeCount = LINKGAME_TILE_TYPE_COUNT[difficulty];

  if (pairs !== totalCells / 2) {
    throw new Error(`Invalid config: pairs (${pairs}) must equal totalCells/2 (${totalCells / 2})`);
  }

  const tiles: string[] = [];
  for (let i = 0; i < pairs; i++) {
    const tileId = LINKGAME_TILE_IDS[i % tileTypeCount];
    tiles.push(tileId, tileId);
  }

  let lastLayout: string[] = [];
  for (let attempt = 0; attempt < MAX_SHUFFLE_ATTEMPTS; attempt++) {
    const rng = seedrandom(`${seed}-gen-${attempt}`);
    const layout = shuffleArray(tiles, rng);
    lastLayout = layout;

    const hint = findHintInternal(layout, rows, cols);
    if (hint !== null) {
      return layout;
    }
  }

  return lastLayout;
}

export function checkGameComplete(board: (string | null)[]): boolean {
  return board.every((tile) => tile === null);
}

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
