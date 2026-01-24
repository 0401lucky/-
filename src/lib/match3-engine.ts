import seedrandom from 'seedrandom';

export interface Match3Config {
  rows: number;
  cols: number;
  types: number;
}

export interface Match3Move {
  from: number;
  to: number;
}

export interface Match3SimulateStats {
  movesApplied: number;
  cascades: number;
  tilesCleared: number;
}

export type Match3SimulateResult =
  | {
      ok: true;
      score: number;
      finalBoard: number[];
      stats: Match3SimulateStats;
    }
  | {
      ok: false;
      message: string;
    };

export const MATCH3_DEFAULT_CONFIG: Match3Config = {
  rows: 8,
  cols: 8,
  types: 6,
};

const EMPTY = -1;
const BASE_TILE_SCORE = 2;

type Rng = () => number;

function assertConfig(config: Match3Config): { ok: true } | { ok: false; message: string } {
  if (!Number.isInteger(config.rows) || config.rows < 3 || config.rows > 12) {
    return { ok: false, message: '无效的行数配置' };
  }
  if (!Number.isInteger(config.cols) || config.cols < 3 || config.cols > 12) {
    return { ok: false, message: '无效的列数配置' };
  }
  if (!Number.isInteger(config.types) || config.types < 4 || config.types > 10) {
    return { ok: false, message: '无效的方块类型配置' };
  }
  return { ok: true };
}

function isInside(index: number, config: Match3Config): boolean {
  return Number.isInteger(index) && index >= 0 && index < config.rows * config.cols;
}

function rowOf(index: number, config: Match3Config): number {
  return Math.floor(index / config.cols);
}

function colOf(index: number, config: Match3Config): number {
  return index % config.cols;
}

function areAdjacent(a: number, b: number, config: Match3Config): boolean {
  if (!isInside(a, config) || !isInside(b, config)) return false;
  const dr = Math.abs(rowOf(a, config) - rowOf(b, config));
  const dc = Math.abs(colOf(a, config) - colOf(b, config));
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

function randomTile(rng: Rng, types: number): number {
  return Math.floor(rng() * types);
}

function generateInitialBoard(config: Match3Config, rng: Rng): number[] {
  const board = new Array<number>(config.rows * config.cols);

  for (let index = 0; index < board.length; index++) {
    const r = rowOf(index, config);
    const c = colOf(index, config);

    let tile = randomTile(rng, config.types);
    for (let attempt = 0; attempt < 10; attempt++) {
      tile = randomTile(rng, config.types);

      if (c >= 2 && board[index - 1] === tile && board[index - 2] === tile) continue;
      if (r >= 2 && board[index - config.cols] === tile && board[index - 2 * config.cols] === tile) continue;

      break;
    }
    board[index] = tile;
  }

  return board;
}

function findMatches(board: number[], config: Match3Config): Set<number> {
  const matches = new Set<number>();

  // Horizontal
  for (let r = 0; r < config.rows; r++) {
    let runStart = 0;
    while (runStart < config.cols) {
      const startIndex = r * config.cols + runStart;
      const tile = board[startIndex];
      let runEnd = runStart + 1;
      while (runEnd < config.cols) {
        const idx = r * config.cols + runEnd;
        if (board[idx] !== tile) break;
        runEnd++;
      }

      const runLength = runEnd - runStart;
      if (tile !== EMPTY && runLength >= 3) {
        for (let c = runStart; c < runEnd; c++) {
          matches.add(r * config.cols + c);
        }
      }
      runStart = runEnd;
    }
  }

  // Vertical
  for (let c = 0; c < config.cols; c++) {
    let runStart = 0;
    while (runStart < config.rows) {
      const startIndex = runStart * config.cols + c;
      const tile = board[startIndex];
      let runEnd = runStart + 1;
      while (runEnd < config.rows) {
        const idx = runEnd * config.cols + c;
        if (board[idx] !== tile) break;
        runEnd++;
      }

      const runLength = runEnd - runStart;
      if (tile !== EMPTY && runLength >= 3) {
        for (let r = runStart; r < runEnd; r++) {
          matches.add(r * config.cols + c);
        }
      }
      runStart = runEnd;
    }
  }

  return matches;
}

function dropAndFill(board: number[], config: Match3Config, rng: Rng): void {
  for (let c = 0; c < config.cols; c++) {
    const newCol: number[] = [];
    for (let r = config.rows - 1; r >= 0; r--) {
      const idx = r * config.cols + c;
      const tile = board[idx];
      if (tile !== EMPTY) newCol.push(tile);
    }

    while (newCol.length < config.rows) {
      newCol.push(randomTile(rng, config.types));
    }

    for (let r = config.rows - 1; r >= 0; r--) {
      const idx = r * config.cols + c;
      board[idx] = newCol[config.rows - 1 - r];
    }
  }
}

function scoreForCascade(tilesCleared: number, cascadeIndex: number): number {
  const perTile = BASE_TILE_SCORE + Math.max(0, cascadeIndex - 1);
  return tilesCleared * perTile;
}

function applyMove(board: number[], config: Match3Config, rng: Rng, move: Match3Move) {
  if (!Number.isInteger(move.from) || !Number.isInteger(move.to)) {
    return { ok: false as const, message: '无效的交换坐标类型' };
  }
  if (!areAdjacent(move.from, move.to, config)) {
    return { ok: false as const, message: '只能交换相邻方块' };
  }

  const a = board[move.from];
  const b = board[move.to];
  board[move.from] = b;
  board[move.to] = a;

  let matches = findMatches(board, config);
  if (matches.size === 0) {
    // 不允许“无消除交换”，回滚
    board[move.from] = a;
    board[move.to] = b;
    return { ok: false as const, message: '该交换不会产生消除' };
  }

  let scoreDelta = 0;
  let cascades = 0;
  let tilesCleared = 0;

  while (matches.size > 0) {
    cascades++;
    const clearedThis = matches.size;
    tilesCleared += clearedThis;
    scoreDelta += scoreForCascade(clearedThis, cascades);

    for (const idx of matches) {
      board[idx] = EMPTY;
    }

    dropAndFill(board, config, rng);
    matches = findMatches(board, config);
  }

  return { ok: true as const, scoreDelta, cascades, tilesCleared };
}

export function createInitialBoard(seed: string, config: Match3Config): Match3SimulateResult {
  const configCheck = assertConfig(config);
  if (!configCheck.ok) return { ok: false, message: configCheck.message };
  if (typeof seed !== 'string' || seed.trim() === '') {
    return { ok: false, message: '无效的种子' };
  }

  const rng = seedrandom(seed);
  const board = generateInitialBoard(config, rng);
  return {
    ok: true,
    score: 0,
    finalBoard: board,
    stats: { movesApplied: 0, cascades: 0, tilesCleared: 0 },
  };
}

export function simulateMatch3Game(
  seed: string,
  config: Match3Config,
  moves: Match3Move[],
  options?: { maxMoves?: number }
): Match3SimulateResult {
  const configCheck = assertConfig(config);
  if (!configCheck.ok) return { ok: false, message: configCheck.message };
  if (typeof seed !== 'string' || seed.trim() === '') {
    return { ok: false, message: '无效的种子' };
  }

  if (!Array.isArray(moves)) {
    return { ok: false, message: '无效的操作序列' };
  }

  const maxMoves = options?.maxMoves ?? 250;
  if (!Number.isInteger(maxMoves) || maxMoves < 1 || maxMoves > 2000) {
    return { ok: false, message: '无效的最大步数限制' };
  }
  if (moves.length > maxMoves) {
    return { ok: false, message: '操作步数过多' };
  }

  const rng = seedrandom(seed);
  const board = generateInitialBoard(config, rng);

  let score = 0;
  let totalCascades = 0;
  let totalTilesCleared = 0;

  for (const move of moves) {
    if (!move || typeof move !== 'object') {
      return { ok: false, message: '操作数据格式错误' };
    }

    const applied = applyMove(board, config, rng, move);
    if (!applied.ok) {
      return { ok: false, message: applied.message };
    }

    score += applied.scoreDelta;
    totalCascades += applied.cascades;
    totalTilesCleared += applied.tilesCleared;
  }

  return {
    ok: true,
    score,
    finalBoard: board,
    stats: {
      movesApplied: moves.length,
      cascades: totalCascades,
      tilesCleared: totalTilesCleared,
    },
  };
}

