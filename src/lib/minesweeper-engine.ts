import seedrandom from 'seedrandom';

export const MINESWEEPER_VERSION = 1;
export const MINESWEEPER_MAX_ACTIONS = 999;

export type MinesweeperDifficulty = 'easy' | 'normal' | 'hard';
export type MinesweeperStatus = 'playing' | 'won' | 'lost';
export type MinesweeperCellDisplay = 'hidden' | 'flagged' | 'revealed' | 'mine' | 'exploded';

export interface MinesweeperDifficultyConfig {
  id: MinesweeperDifficulty;
  label: string;
  rows: number;
  cols: number;
  mines: number;
  baseScore: number;
  timeLimitSeconds: number;
}

export interface MinesweeperPosition {
  row: number;
  col: number;
}

export interface MinesweeperCell {
  row: number;
  col: number;
  mine: boolean;
  adjacent: number;
  revealed: boolean;
  flagged: boolean;
}

export interface MinesweeperCellView {
  row: number;
  col: number;
  display: MinesweeperCellDisplay;
  adjacent: number;
}

export interface MinesweeperGameState {
  version: typeof MINESWEEPER_VERSION;
  seed: string;
  difficulty: MinesweeperDifficulty;
  rows: number;
  cols: number;
  mines: number;
  status: MinesweeperStatus;
  firstRevealDone: boolean;
  firstReveal?: MinesweeperPosition;
  cells: MinesweeperCell[];
  revealedSafe: number;
  flagsUsed: number;
  moves: number;
  exploded?: MinesweeperPosition;
  endedAt?: number;
}

export type MinesweeperAction =
  | { type: 'reveal'; position: MinesweeperPosition }
  | { type: 'flag'; position: MinesweeperPosition }
  | { type: 'chord'; position: MinesweeperPosition };

export interface MinesweeperActionOutcome {
  type: MinesweeperAction['type'];
  message: string;
  revealedDelta: number;
  flagDelta: number;
  status: MinesweeperStatus;
}

export type MinesweeperActionResult =
  | { ok: true; state: MinesweeperGameState; outcome: MinesweeperActionOutcome }
  | { ok: false; message: string };

export interface MinesweeperScoreBreakdown {
  difficultyBase: number;
  revealPoints: number;
  flagPoints: number;
  timeBonus: number;
  winBonus: number;
  total: number;
}

export interface MinesweeperStateView {
  difficulty: MinesweeperDifficulty;
  rows: number;
  cols: number;
  mines: number;
  status: MinesweeperStatus;
  cells: MinesweeperCellView[];
  revealedSafe: number;
  flagsUsed: number;
  moves: number;
  exploded?: MinesweeperPosition;
  endedAt?: number;
}

export const MINESWEEPER_DIFFICULTY_CONFIG: Record<MinesweeperDifficulty, MinesweeperDifficultyConfig> = {
  easy: {
    id: 'easy',
    label: '简单',
    rows: 9,
    cols: 9,
    mines: 10,
    baseScore: 500,
    timeLimitSeconds: 180,
  },
  normal: {
    id: 'normal',
    label: '普通',
    rows: 12,
    cols: 12,
    mines: 24,
    baseScore: 1000,
    timeLimitSeconds: 300,
  },
  hard: {
    id: 'hard',
    label: '困难',
    rows: 16,
    cols: 16,
    mines: 40,
    baseScore: 1800,
    timeLimitSeconds: 480,
  },
};

export const MINESWEEPER_POINT_REWARD_DIVISOR = 28;

export function positionKey(position: MinesweeperPosition): string {
  return `${position.row}:${position.col}`;
}

function cloneState(state: MinesweeperGameState): MinesweeperGameState {
  return {
    ...state,
    firstReveal: state.firstReveal ? { ...state.firstReveal } : undefined,
    exploded: state.exploded ? { ...state.exploded } : undefined,
    endedAt: state.endedAt,
    cells: state.cells.map((cell) => ({ ...cell })),
  };
}

function getConfig(difficulty: MinesweeperDifficulty): MinesweeperDifficultyConfig {
  return MINESWEEPER_DIFFICULTY_CONFIG[difficulty];
}

function isValidPosition(state: Pick<MinesweeperGameState, 'rows' | 'cols'>, position: MinesweeperPosition): boolean {
  return Number.isInteger(position.row)
    && Number.isInteger(position.col)
    && position.row >= 0
    && position.row < state.rows
    && position.col >= 0
    && position.col < state.cols;
}

function getCell(state: MinesweeperGameState, position: MinesweeperPosition): MinesweeperCell | undefined {
  if (!isValidPosition(state, position)) return undefined;
  return state.cells[position.row * state.cols + position.col];
}

function neighborsOf(state: Pick<MinesweeperGameState, 'rows' | 'cols'>, position: MinesweeperPosition): MinesweeperPosition[] {
  const neighbors: MinesweeperPosition[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const next = { row: position.row + dr, col: position.col + dc };
      if (isValidPosition(state, next)) {
        neighbors.push(next);
      }
    }
  }
  return neighbors;
}

function createEmptyCells(rows: number, cols: number): MinesweeperCell[] {
  const cells: MinesweeperCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({ row, col, mine: false, adjacent: 0, revealed: false, flagged: false });
    }
  }
  return cells;
}

function shuffle<T>(items: T[], seed: string): T[] {
  const rng = seedrandom(seed);
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function createInitialMinesweeperState(
  seed: string,
  difficulty: MinesweeperDifficulty,
): MinesweeperGameState {
  const config = getConfig(difficulty);
  return {
    version: MINESWEEPER_VERSION,
    seed,
    difficulty,
    rows: config.rows,
    cols: config.cols,
    mines: config.mines,
    status: 'playing',
    firstRevealDone: false,
    cells: createEmptyCells(config.rows, config.cols),
    revealedSafe: 0,
    flagsUsed: 0,
    moves: 0,
  };
}

export function generateMinesweeperMinePositions(
  seed: string,
  difficulty: MinesweeperDifficulty,
  firstReveal: MinesweeperPosition,
): MinesweeperPosition[] {
  const config = getConfig(difficulty);
  const safe = new Set<string>([
    positionKey(firstReveal),
    ...neighborsOf({ rows: config.rows, cols: config.cols }, firstReveal).map(positionKey),
  ]);

  const candidates: MinesweeperPosition[] = [];
  for (let row = 0; row < config.rows; row += 1) {
    for (let col = 0; col < config.cols; col += 1) {
      const position = { row, col };
      if (!safe.has(positionKey(position))) {
        candidates.push(position);
      }
    }
  }

  return shuffle(candidates, `${seed}:minesweeper:${difficulty}:${positionKey(firstReveal)}`)
    .slice(0, config.mines)
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

function layMines(state: MinesweeperGameState, firstReveal: MinesweeperPosition): void {
  const mineKeys = new Set(
    generateMinesweeperMinePositions(state.seed, state.difficulty, firstReveal).map(positionKey),
  );

  for (const cell of state.cells) {
    cell.mine = mineKeys.has(positionKey(cell));
    cell.adjacent = 0;
  }

  for (const cell of state.cells) {
    if (cell.mine) continue;
    cell.adjacent = neighborsOf(state, cell)
      .reduce((count, neighbor) => count + (getCell(state, neighbor)?.mine ? 1 : 0), 0);
  }

  state.firstRevealDone = true;
  state.firstReveal = { ...firstReveal };
}

function revealSafeCell(state: MinesweeperGameState, cell: MinesweeperCell): number {
  if (cell.revealed || cell.flagged || cell.mine) {
    return 0;
  }
  cell.revealed = true;
  state.revealedSafe += 1;
  return 1;
}

function floodReveal(state: MinesweeperGameState, start: MinesweeperCell): number {
  const queue: MinesweeperCell[] = [start];
  const seen = new Set<string>();
  let revealed = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = positionKey(current);
    if (seen.has(key)) continue;
    seen.add(key);

    const delta = revealSafeCell(state, current);
    revealed += delta;
    if (delta === 0 || current.adjacent !== 0) {
      continue;
    }

    for (const neighborPosition of neighborsOf(state, current)) {
      const neighbor = getCell(state, neighborPosition);
      if (neighbor && !neighbor.mine && !neighbor.revealed && !neighbor.flagged) {
        queue.push(neighbor);
      }
    }
  }

  return revealed;
}

function checkWin(state: MinesweeperGameState): void {
  const safeCells = state.rows * state.cols - state.mines;
  if (state.revealedSafe >= safeCells) {
    state.status = 'won';
    for (const cell of state.cells) {
      if (cell.mine && !cell.flagged) {
        cell.flagged = true;
      }
    }
    state.flagsUsed = state.cells.filter((cell) => cell.flagged).length;
  }
}

function resolveReveal(state: MinesweeperGameState, position: MinesweeperPosition): MinesweeperActionResult {
  const cell = getCell(state, position);
  if (!cell) return { ok: false, message: '格子坐标无效' };
  if (cell.flagged) return { ok: false, message: '已插旗的格子不能翻开' };
  if (cell.revealed) return { ok: false, message: '这个格子已经翻开了' };

  if (!state.firstRevealDone) {
    layMines(state, position);
  }

  state.moves += 1;
  if (cell.mine) {
    cell.revealed = true;
    state.status = 'lost';
    state.exploded = { row: cell.row, col: cell.col };
    return {
      ok: true,
      state,
      outcome: {
        type: 'reveal',
        message: '踩到雷了，本局结束',
        revealedDelta: 0,
        flagDelta: 0,
        status: state.status,
      },
    };
  }

  const revealedDelta = floodReveal(state, cell);
  checkWin(state);
  return {
    ok: true,
    state,
    outcome: {
      type: 'reveal',
      message: state.status === 'won' ? '所有安全格都已清除，扫雷成功！' : `翻开 ${revealedDelta} 个安全格`,
      revealedDelta,
      flagDelta: 0,
      status: state.status,
    },
  };
}

function resolveFlag(state: MinesweeperGameState, position: MinesweeperPosition): MinesweeperActionResult {
  const cell = getCell(state, position);
  if (!cell) return { ok: false, message: '格子坐标无效' };
  if (cell.revealed) return { ok: false, message: '已翻开的格子不能插旗' };

  if (cell.flagged) {
    cell.flagged = false;
    state.flagsUsed -= 1;
    state.moves += 1;
    return {
      ok: true,
      state,
      outcome: {
        type: 'flag',
        message: '已移除旗帜',
        revealedDelta: 0,
        flagDelta: -1,
        status: state.status,
      },
    };
  }

  if (state.flagsUsed >= state.mines) {
    return { ok: false, message: '旗帜数量已达到雷数上限' };
  }

  cell.flagged = true;
  state.flagsUsed += 1;
  state.moves += 1;
  return {
    ok: true,
    state,
    outcome: {
      type: 'flag',
      message: '已标记疑似地雷',
      revealedDelta: 0,
      flagDelta: 1,
      status: state.status,
    },
  };
}

function resolveChord(state: MinesweeperGameState, position: MinesweeperPosition): MinesweeperActionResult {
  const cell = getCell(state, position);
  if (!cell) return { ok: false, message: '格子坐标无效' };
  if (!cell.revealed || cell.adjacent <= 0) {
    return { ok: false, message: '只有已翻开的数字格可以快速展开' };
  }

  const neighbors = neighborsOf(state, position)
    .map((neighbor) => getCell(state, neighbor))
    .filter((neighbor): neighbor is MinesweeperCell => Boolean(neighbor));
  const flags = neighbors.filter((neighbor) => neighbor.flagged).length;
  if (flags !== cell.adjacent) {
    return { ok: false, message: '周围旗帜数量与数字不一致' };
  }

  let totalRevealed = 0;
  state.moves += 1;
  for (const neighbor of neighbors) {
    if (neighbor.revealed || neighbor.flagged) continue;
    if (neighbor.mine) {
      neighbor.revealed = true;
      state.status = 'lost';
      state.exploded = { row: neighbor.row, col: neighbor.col };
      return {
        ok: true,
        state,
        outcome: {
          type: 'chord',
          message: '快速展开时踩到雷了',
          revealedDelta: totalRevealed,
          flagDelta: 0,
          status: state.status,
        },
      };
    }
    totalRevealed += floodReveal(state, neighbor);
  }

  checkWin(state);
  return {
    ok: true,
    state,
    outcome: {
      type: 'chord',
      message: state.status === 'won' ? '所有安全格都已清除，扫雷成功！' : `快速展开 ${totalRevealed} 个安全格`,
      revealedDelta: totalRevealed,
      flagDelta: 0,
      status: state.status,
    },
  };
}

export function resolveMinesweeperAction(
  state: MinesweeperGameState,
  action: MinesweeperAction,
): MinesweeperActionResult {
  if (state.status !== 'playing') {
    return { ok: false, message: '游戏已经结束' };
  }

  const next = cloneState(state);
  if (action.type === 'reveal') {
    return resolveReveal(next, action.position);
  }
  if (action.type === 'flag') {
    return resolveFlag(next, action.position);
  }
  if (action.type === 'chord') {
    return resolveChord(next, action.position);
  }
  return { ok: false, message: '未知操作' };
}

export function buildMinesweeperStateView(state: MinesweeperGameState): MinesweeperStateView {
  const revealMines = state.status !== 'playing';
  return {
    difficulty: state.difficulty,
    rows: state.rows,
    cols: state.cols,
    mines: state.mines,
    status: state.status,
    revealedSafe: state.revealedSafe,
    flagsUsed: state.flagsUsed,
    moves: state.moves,
    exploded: state.exploded ? { ...state.exploded } : undefined,
    endedAt: state.endedAt,
    cells: state.cells.map((cell) => {
      let display: MinesweeperCellDisplay = 'hidden';
      if (state.exploded && state.exploded.row === cell.row && state.exploded.col === cell.col) {
        display = 'exploded';
      } else if (cell.revealed) {
        display = cell.mine ? 'mine' : 'revealed';
      } else if (cell.flagged) {
        display = 'flagged';
      } else if (revealMines && cell.mine) {
        display = 'mine';
      }

      return {
        row: cell.row,
        col: cell.col,
        display,
        adjacent: cell.revealed || revealMines ? cell.adjacent : 0,
      };
    }),
  };
}

export function calculateMinesweeperScore(
  state: MinesweeperGameState,
  durationMs: number,
): MinesweeperScoreBreakdown {
  const config = getConfig(state.difficulty);
  const safeCells = state.rows * state.cols - state.mines;
  const revealRatio = safeCells > 0 ? state.revealedSafe / safeCells : 0;
  const difficultyBase = Math.round(config.baseScore * revealRatio);
  const revealPoints = state.revealedSafe * (state.difficulty === 'hard' ? 8 : state.difficulty === 'normal' ? 6 : 4);
  const flagPoints = state.status === 'won'
    ? state.mines * 6
    : Math.max(0, state.cells.filter((cell) => cell.flagged && cell.mine).length * 3);
  const usedSeconds = Math.max(0, Math.ceil(durationMs / 1000));
  const timeBonus = state.status === 'won'
    ? Math.max(0, config.timeLimitSeconds - usedSeconds) * (state.difficulty === 'hard' ? 4 : state.difficulty === 'normal' ? 3 : 2)
    : 0;
  const winBonus = state.status === 'won' ? Math.round(config.baseScore * 0.35) : 0;
  const total = Math.max(0, Math.min(5000, difficultyBase + revealPoints + flagPoints + timeBonus + winBonus));

  return {
    difficultyBase,
    revealPoints,
    flagPoints,
    timeBonus,
    winBonus,
    total,
  };
}

export function calculateMinesweeperPointReward(score: number): number {
  return Math.max(0, Math.floor(score / MINESWEEPER_POINT_REWARD_DIVISOR));
}
