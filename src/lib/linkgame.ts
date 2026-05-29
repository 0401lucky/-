import seedrandom from 'seedrandom';
import type {
  LinkGameDifficulty,
  LinkGameDifficultyConfig,
  LinkGameLayerConfig,
  LinkGamePosition,
  LinkGameRecord,
  LinkGameSettlementOutcome,
  LinkGameSettlementResult,
} from './types/game';

export const LINKGAME_TILE_IDS = [
  '🍎', '🍊', '🍋', '🍇', '🍓', '🍒', '🍑', '🥝',
  '🍌', '🍉', '🥭', '🍍', '🫐', '🍈', '🍐', '🥥',
  '🍏', '🥑', '🍅', '🫒', '🍆', '🌶️', '🥬', '🥕',
  '🌽', '🥔', '🍠', '🫘', '🫛', '🫑', '🥒', '🧄',
  '🧅', '🥦', '🍄', '🥜', '🌰', '🫚', '🥐', '🥨',
  '🥯', '🥞', '🧇', '🧀', '🍞', '🥖', '🫓', '🥮',
  '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂',
  '🍮', '🍭', '🍬', '🍫', '🍯', '🥛', '🧃', '🧋',
  '🍵', '🥤',
];

export const LINKGAME_TILE_TYPE_COUNT: Record<LinkGameDifficulty, number> = {
  easy: 8,
  normal: 12,
  hard: 24,
};

export const LINKGAME_HARD_DEADLOCK_RATE_BY_STAGE = [0, 0.025, 0.05, 0.1, 0] as const;
export const LINKGAME_HARD_MAX_DEADLOCK_RATE = 0.1;
export const LINKGAME_HARD_WIN_OUTCOME: LinkGameSettlementOutcome = 'completed';
export const LINKGAME_HARD_LOSS_OUTCOMES = ['deadlock', 'timeout'] as const;

function cellsFromMask(rows: string[]): Array<{ row: number; col: number }> {
  return rows.flatMap((line, row) =>
    [...line].flatMap((cell, col) => cell === '1' ? [{ row, col }] : [])
  );
}

export const LINKGAME_STACK_LAYERS: LinkGameLayerConfig[] = [
  {
    z: 0,
    rowStart: 0,
    colStart: 0,
    rows: 8,
    cols: 8,
    cells: cellsFromMask([
      '11111111',
      '11111111',
      '11111111',
      '11111111',
      '11111111',
      '11111111',
      '11111111',
      '11111111',
    ]),
  },
  {
    z: 1,
    rowStart: 0,
    colStart: 0,
    rows: 8,
    cols: 8,
    cells: cellsFromMask([
      '00000000',
      '00111100',
      '00111100',
      '01111110',
      '01111110',
      '00111100',
      '00000000',
      '00000000',
    ]),
  },
  {
    z: 2,
    rowStart: 0,
    colStart: 0,
    rows: 8,
    cols: 8,
    cells: cellsFromMask([
      '00000000',
      '00111100',
      '00111100',
      '00111100',
      '00111100',
      '00111100',
      '00000000',
      '00000000',
    ]),
  },
  {
    z: 3,
    rowStart: 0,
    colStart: 0,
    rows: 8,
    cols: 8,
    cells: cellsFromMask([
      '00000000',
      '00000000',
      '00011000',
      '00111100',
      '00111100',
      '00011000',
      '00000000',
      '00000000',
    ]),
  },
  {
    z: 4,
    rowStart: 0,
    colStart: 0,
    rows: 8,
    cols: 8,
    cells: cellsFromMask([
      '00000000',
      '00000000',
      '00011000',
      '00111100',
      '00111100',
      '00011000',
      '00000000',
      '00000000',
    ]),
  },
];

export const LINKGAME_DIFFICULTY_CONFIG: Record<LinkGameDifficulty, LinkGameDifficultyConfig> = {
  easy: {
    rows: 8,
    cols: 8,
    pairs: 32,
    baseScore: 15,
    timeLimit: 180,
    mode: 'classic2d',
  },
  normal: {
    rows: 8,
    cols: 10,
    pairs: 40,
    baseScore: 18,
    timeLimit: 210,
    mode: 'classic2d',
  },
  hard: {
    rows: 8,
    cols: 8,
    pairs: 66,
    baseScore: 24,
    timeLimit: 300,
    mode: 'stack3d',
    depth: 5,
    layers: LINKGAME_STACK_LAYERS,
  },
};

type Rng = () => number;

const MAX_SHUFFLE_ATTEMPTS = 100;
const DEFAULT_Z = 0;

function shuffleArray<T>(arr: T[], rng: Rng): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function zOf(pos: LinkGamePosition): number {
  return pos.z ?? DEFAULT_Z;
}

function samePosition(a: LinkGamePosition, b: LinkGamePosition): boolean {
  return a.row === b.row && a.col === b.col && zOf(a) === zOf(b);
}

export function isStack3DConfig(config: LinkGameDifficultyConfig): boolean {
  return config.mode === 'stack3d';
}

export function getBoardDepth(config: LinkGameDifficultyConfig): number {
  if (!isStack3DConfig(config)) return 1;
  if (config.depth && config.depth > 0) return config.depth;
  const maxLayerZ = Math.max(...(config.layers ?? []).map((layer) => layer.z), 0);
  return maxLayerZ + 1;
}

function getLayer(config: LinkGameDifficultyConfig, z: number): LinkGameLayerConfig | null {
  if (!isStack3DConfig(config)) {
    return z === 0
      ? { z: 0, rowStart: 0, colStart: 0, rows: config.rows, cols: config.cols }
      : null;
  }
  return config.layers?.find((layer) => layer.z === z) ?? null;
}

export function isActivePosition(config: LinkGameDifficultyConfig, pos: LinkGamePosition): boolean {
  const z = zOf(pos);
  const layer = getLayer(config, z);
  if (!layer) return false;
  if (layer.cells) {
    return layer.cells.some((cell) => cell.row === pos.row && cell.col === pos.col);
  }
  return (
    pos.row >= layer.rowStart &&
    pos.row < layer.rowStart + layer.rows &&
    pos.col >= layer.colStart &&
    pos.col < layer.colStart + layer.cols
  );
}

export function getActivePositions(config: LinkGameDifficultyConfig): LinkGamePosition[] {
  if (!isStack3DConfig(config)) {
    const positions: LinkGamePosition[] = [];
    for (let row = 0; row < config.rows; row++) {
      for (let col = 0; col < config.cols; col++) {
        positions.push({ row, col });
      }
    }
    return positions;
  }

  const positions: LinkGamePosition[] = [];
  for (const layer of config.layers ?? []) {
    if (layer.cells) {
      positions.push(...layer.cells.map((cell) => ({ row: cell.row, col: cell.col, z: layer.z })));
      continue;
    }
    for (let row = layer.rowStart; row < layer.rowStart + layer.rows; row++) {
      for (let col = layer.colStart; col < layer.colStart + layer.cols; col++) {
        positions.push({ row, col, z: layer.z });
      }
    }
  }
  return positions;
}

export function getActiveTileCount(config: LinkGameDifficultyConfig): number {
  return getActivePositions(config).length;
}

export function indexOf(pos: LinkGamePosition, cols: number, rows?: number): number {
  const z = rows ? zOf(pos) : 0;
  return z * (rows ?? 0) * cols + pos.row * cols + pos.col;
}

export function positionOf(index: number, cols: number, rows?: number): LinkGamePosition {
  if (rows && rows > 0) {
    const layerSize = rows * cols;
    const z = Math.floor(index / layerSize);
    const layerIndex = index % layerSize;
    return {
      row: Math.floor(layerIndex / cols),
      col: layerIndex % cols,
      z,
    };
  }

  return {
    row: Math.floor(index / cols),
    col: index % cols,
  };
}

export function indexOfPosition(pos: LinkGamePosition, config: LinkGameDifficultyConfig): number {
  return indexOf(pos, config.cols, config.rows);
}

export function positionOfIndex(index: number, config: LinkGameDifficultyConfig): LinkGamePosition {
  return positionOf(index, config.cols, config.rows);
}

export function getTile(board: (string | null)[], pos: LinkGamePosition, cols: number, rows?: number): string | null {
  const idx = indexOf(pos, cols, rows);
  if (idx < 0 || idx >= board.length) return null;
  return board[idx];
}

export function getTileAt(
  board: (string | null)[],
  pos: LinkGamePosition,
  config: LinkGameDifficultyConfig
): string | null {
  if (!isActivePosition(config, pos)) return null;
  return getTile(board, pos, config.cols, config.rows);
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

export function areStackPositionsAdjacent(pos1: LinkGamePosition, pos2: LinkGamePosition): boolean {
  const rowDistance = Math.abs(pos1.row - pos2.row);
  const colDistance = Math.abs(pos1.col - pos2.col);
  const layerDistance = Math.abs(zOf(pos1) - zOf(pos2));

  if (layerDistance === 0) {
    return rowDistance + colDistance === 1;
  }

  if (layerDistance === 1) {
    return rowDistance <= 1 && colDistance <= 1;
  }

  return false;
}

export function isStackTileBlocked(
  board: (string | null)[],
  pos: LinkGamePosition,
  config: LinkGameDifficultyConfig,
  ignoredPositions: LinkGamePosition[] = []
): boolean {
  if (!isStack3DConfig(config) || !isActivePosition(config, pos)) return false;

  for (let z = zOf(pos) + 1; z < getBoardDepth(config); z++) {
    const upperPos: LinkGamePosition = { row: pos.row, col: pos.col, z };
    if (!isActivePosition(config, upperPos)) continue;
    if (ignoredPositions.some((ignored) => samePosition(ignored, upperPos))) continue;
    if (getTileAt(board, upperPos, config) !== null) {
      return true;
    }
  }

  return false;
}

export function isStackTileSelectable(
  board: (string | null)[],
  pos: LinkGamePosition,
  config: LinkGameDifficultyConfig
): boolean {
  return getTileAt(board, pos, config) !== null && !isStackTileBlocked(board, pos, config);
}

export function canStackMatch(
  board: (string | null)[],
  pos1: LinkGamePosition,
  pos2: LinkGamePosition,
  config: LinkGameDifficultyConfig
): boolean {
  if (!isStack3DConfig(config)) return false;
  if (samePosition(pos1, pos2)) return false;
  if (!isActivePosition(config, pos1) || !isActivePosition(config, pos2)) return false;

  const tile1 = getTileAt(board, pos1, config);
  const tile2 = getTileAt(board, pos2, config);
  if (tile1 === null || tile2 === null || tile1 !== tile2) return false;

  return (
    !isStackTileBlocked(board, pos1, config) &&
    !isStackTileBlocked(board, pos2, config)
  );
}

export function canMatchByConfig(
  board: (string | null)[],
  pos1: LinkGamePosition,
  pos2: LinkGamePosition,
  config: LinkGameDifficultyConfig
): boolean {
  if (isStack3DConfig(config)) {
    return canStackMatch(board, pos1, pos2, config);
  }
  return canMatch(board, pos1, pos2, config.cols);
}

export function removeMatchByConfig(
  board: (string | null)[],
  pos1: LinkGamePosition,
  pos2: LinkGamePosition,
  config: LinkGameDifficultyConfig
): (string | null)[] {
  const newBoard = [...board];
  const idx1 = indexOfPosition(pos1, config);
  const idx2 = indexOfPosition(pos2, config);
  if (idx1 >= 0 && idx1 < newBoard.length) newBoard[idx1] = null;
  if (idx2 >= 0 && idx2 < newBoard.length) newBoard[idx2] = null;
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

export function findStackHintInternal(
  board: (string | null)[],
  config: LinkGameDifficultyConfig
): { pos1: LinkGamePosition; pos2: LinkGamePosition } | null {
  const positions = getActivePositions(config).filter((pos) => getTileAt(board, pos, config) !== null);

  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      if (canStackMatch(board, positions[i], positions[j], config)) {
        return { pos1: positions[i], pos2: positions[j] };
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

export function findHintByConfig(
  board: (string | null)[],
  config: LinkGameDifficultyConfig
): { pos1: LinkGamePosition; pos2: LinkGamePosition } | null {
  if (isStack3DConfig(config)) {
    return findStackHintInternal(board, config);
  }
  return findHintInternal(board, config.rows, config.cols);
}

function positionKey(pos: LinkGamePosition): string {
  return `${zOf(pos)}:${pos.row}:${pos.col}`;
}

export function getStackExposureStages(config: LinkGameDifficultyConfig): LinkGamePosition[][] {
  const stacks: LinkGamePosition[][] = [];

  for (let row = 0; row < config.rows; row++) {
    for (let col = 0; col < config.cols; col++) {
      const stack: LinkGamePosition[] = [];
      for (let z = getBoardDepth(config) - 1; z >= 0; z--) {
        const pos = { row, col, z };
        if (isActivePosition(config, pos)) {
          stack.push(pos);
        }
      }
      if (stack.length > 0) {
        stacks.push(stack);
      }
    }
  }

  const maxHeight = Math.max(0, ...stacks.map((stack) => stack.length));
  return Array.from({ length: maxHeight }, (_, stageIndex) =>
    stacks
      .map((stack) => stack[stageIndex])
      .filter((pos): pos is LinkGamePosition => Boolean(pos))
  );
}

export function getHardDeadlockRateForStage(stageIndex: number): number {
  const clamped = Math.max(0, Math.min(stageIndex, LINKGAME_HARD_DEADLOCK_RATE_BY_STAGE.length - 1));
  return LINKGAME_HARD_DEADLOCK_RATE_BY_STAGE[clamped] ?? 0;
}

export function shouldGenerateHardStageDeadlock(seed: string, stageIndex: number): boolean {
  return seedrandom(`${seed}-hard-stage-${stageIndex}-deadlock`)() < getHardDeadlockRateForStage(stageIndex);
}

export function getPlannedHardDeadlockStage(
  seed: string,
  config: LinkGameDifficultyConfig = LINKGAME_DIFFICULTY_CONFIG.hard
): number | null {
  const stages = getStackExposureStages(config);
  const tileTypeCount = LINKGAME_TILE_TYPE_COUNT.hard;

  // 最底层没有更深的遮挡位可以藏配对牌。为了保证所有卡牌严格两两成对，
  // 计划死局只放在仍有更深层可承接配对牌的阶段。
  for (let stageIndex = 1; stageIndex < stages.length - 1; stageIndex++) {
    const stageSize = stages[stageIndex].length;
    const deeperSize = stages.slice(stageIndex + 1).reduce((sum, stage) => sum + stage.length, 0);
    if (stageSize === 0 || stageSize > tileTypeCount) continue;
    if (deeperSize < stageSize) continue;
    if (shouldGenerateHardStageDeadlock(seed, stageIndex)) {
      return stageIndex;
    }
  }

  return null;
}

function assignTile(layout: (string | null)[], config: LinkGameDifficultyConfig, pos: LinkGamePosition, tile: string) {
  layout[indexOfPosition(pos, config)] = tile;
}

function fillPairedPositions(
  layout: (string | null)[],
  config: LinkGameDifficultyConfig,
  positions: LinkGamePosition[],
  rng: Rng,
  tileTypeCount: number,
  stageSalt: string
) {
  const shuffledPositions = shuffleArray(positions, rng);
  const tileIds = shuffleArray(LINKGAME_TILE_IDS.slice(0, tileTypeCount), seedrandom(stageSalt));

  for (let i = 0; i + 1 < shuffledPositions.length; i += 2) {
    const tile = tileIds[(i / 2) % tileIds.length];
    assignTile(layout, config, shuffledPositions[i], tile);
    assignTile(layout, config, shuffledPositions[i + 1], tile);
  }
}

function generateStackTileLayout(
  difficulty: LinkGameDifficulty,
  config: LinkGameDifficultyConfig,
  seed: string
): (string | null)[] {
  const activeCount = getActiveTileCount(config);
  const totalCells = config.rows * config.cols * getBoardDepth(config);
  const tileTypeCount = LINKGAME_TILE_TYPE_COUNT[difficulty];

  if (config.pairs !== activeCount / 2) {
    throw new Error(`Invalid stack config: pairs (${config.pairs}) must equal activeCells/2 (${activeCount / 2})`);
  }

  if (difficulty === 'hard') {
    const stages = getStackExposureStages(config);
    const rng = seedrandom(`${seed}-stack-stage-gen`);
    const layout: (string | null)[] = new Array(totalCells).fill(null);
    const used = new Set<string>();
    const deadlockStage = getPlannedHardDeadlockStage(seed, config);

    if (deadlockStage !== null) {
      const trapPositions = shuffleArray(stages[deadlockStage], rng);
      const hiddenMatePositions = shuffleArray(stages.slice(deadlockStage + 1).flat(), rng)
        .slice(0, trapPositions.length);
      const trapTiles = shuffleArray(LINKGAME_TILE_IDS.slice(0, tileTypeCount), rng)
        .slice(0, trapPositions.length);

      for (let i = 0; i < trapPositions.length; i++) {
        assignTile(layout, config, trapPositions[i], trapTiles[i]);
        assignTile(layout, config, hiddenMatePositions[i], trapTiles[i]);
        used.add(positionKey(trapPositions[i]));
        used.add(positionKey(hiddenMatePositions[i]));
      }
    }

    for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
      const positions = stages[stageIndex].filter((pos) => !used.has(positionKey(pos)));
      fillPairedPositions(
        layout,
        config,
        positions,
        seedrandom(`${seed}-stack-stage-${stageIndex}`),
        tileTypeCount,
        `${seed}-stack-stage-${stageIndex}-tiles`
      );
    }

    const unfilledPositions = getActivePositions(config)
      .filter((pos) => layout[indexOfPosition(pos, config)] === null);
    fillPairedPositions(
      layout,
      config,
      unfilledPositions,
      seedrandom(`${seed}-stack-unfilled`),
      tileTypeCount,
      `${seed}-stack-unfilled-tiles`
    );

    if (findStackHintInternal(layout, config) !== null) {
      return layout;
    }
  }

  let lastLayout: (string | null)[] = new Array(totalCells).fill(null);
  for (let attempt = 0; attempt < MAX_SHUFFLE_ATTEMPTS; attempt++) {
    const rng = seedrandom(`${seed}-stack-fallback-${attempt}`);
    const layout: (string | null)[] = new Array(totalCells).fill(null);
    fillPairedPositions(layout, config, getActivePositions(config), rng, tileTypeCount, `${seed}-fallback-${attempt}`);
    lastLayout = layout;
    if (findStackHintInternal(layout, config) !== null) {
      return layout;
    }
  }

  return lastLayout;
}

export function generateTileLayout(difficulty: LinkGameDifficulty, seed: string): (string | null)[] {
  const config = LINKGAME_DIFFICULTY_CONFIG[difficulty];
  const { rows, cols, pairs } = config;

  if (isStack3DConfig(config)) {
    return generateStackTileLayout(difficulty, config, seed);
  }

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

export function getLinkGameSettlementResult(
  completed: boolean,
  outcome: LinkGameSettlementOutcome = completed ? 'completed' : 'timeout'
): LinkGameSettlementResult {
  return completed && outcome === LINKGAME_HARD_WIN_OUTCOME ? 'win' : 'loss';
}

export function isHardModeWin(record: Pick<LinkGameRecord, 'difficulty' | 'completed' | 'outcome'>): boolean {
  return record.difficulty === 'hard' &&
    getLinkGameSettlementResult(record.completed, record.outcome ?? (record.completed ? 'completed' : 'timeout')) === 'win';
}

export function calculateHardModeWinRate(
  records: Array<Pick<LinkGameRecord, 'difficulty' | 'completed' | 'outcome'>>
): { total: number; wins: number; losses: number; winRate: number } {
  const hardRecords = records.filter((record) => record.difficulty === 'hard');
  const wins = hardRecords.filter(isHardModeWin).length;
  const total = hardRecords.length;

  return {
    total,
    wins,
    losses: total - wins,
    winRate: total === 0 ? 0 : wins / total,
  };
}

export interface ScoreParams {
  matchedPairs: number;
  baseScore: number;
  combo: number;
  timeRemainingSeconds: number;
  difficulty?: LinkGameDifficulty;
  totalPairs?: number;
  outcome?: LinkGameSettlementOutcome;
}

export function calculateHardScore(params: ScoreParams): number {
  const matchedPairs = Math.max(0, params.matchedPairs);
  const baseScore = Math.max(0, params.baseScore);
  const totalPairs = Math.max(1, params.totalPairs ?? LINKGAME_DIFFICULTY_CONFIG.hard.pairs);
  const progress = Math.min(1, matchedPairs / totalPairs);
  const base = matchedPairs * baseScore;
  const pressureBonus = Math.round(base * progress * 0.8);
  const timeRemainingSeconds = Math.max(0, params.timeRemainingSeconds);
  const timeBonus =
    params.outcome === 'completed'
      ? timeRemainingSeconds * 2
      : params.outcome === 'deadlock'
        ? Math.floor(timeRemainingSeconds * 0.5)
        : 0;
  const completionBonus = params.outcome === 'completed'
    ? Math.round(totalPairs * baseScore * 0.2)
    : 0;
  const deadlockConsolation = params.outcome === 'deadlock'
    ? Math.round(base * 0.15)
    : 0;

  return Math.round(Math.max(0, base + pressureBonus + timeBonus + completionBonus + deadlockConsolation));
}

export function calculateScore(params: ScoreParams): number {
  if (params.difficulty === 'hard') {
    return calculateHardScore(params);
  }

  const {
    matchedPairs,
    baseScore,
    combo,
    timeRemainingSeconds,
  } = params;

  const comboMultiplier = Math.min(1.5, 1 + combo * 0.1);
  const timeBonus = timeRemainingSeconds * 1;
  const rawScore =
    matchedPairs * baseScore * comboMultiplier +
    timeBonus;

  return Math.round(Math.max(0, rawScore));
}

export const LINKGAME_POINT_REWARD_PERCENT = 1;
export const LINKGAME_HARD_DEADLOCK_REWARD_PERCENT = 10;
export const LINKGAME_HARD_COMPLETION_REWARD_PERCENT = 20;
export const LINKGAME_HARD_TIMEOUT_REWARD_PERCENT = 1;

export function getLinkGamePointRewardPercent(
  difficulty: LinkGameDifficulty = 'easy',
  outcome: LinkGameSettlementOutcome = 'completed'
): number {
  if (difficulty === 'hard' && outcome === 'deadlock') {
    return LINKGAME_HARD_DEADLOCK_REWARD_PERCENT;
  }
  if (difficulty === 'hard' && outcome === 'completed') {
    return LINKGAME_HARD_COMPLETION_REWARD_PERCENT;
  }
  if (difficulty === 'hard' && outcome === 'timeout') {
    return LINKGAME_HARD_TIMEOUT_REWARD_PERCENT;
  }
  return LINKGAME_POINT_REWARD_PERCENT;
}

/**
 * 计算连连看福利积分：普通规则按 1%，困难死局按 10%，困难胜利按 20%，困难超时按 1%，向下取整。
 */
export function calculateLinkGamePointReward(
  score: number,
  difficulty: LinkGameDifficulty = 'easy',
  outcome: LinkGameSettlementOutcome = 'completed'
): number {
  const percent = getLinkGamePointRewardPercent(difficulty, outcome);
  return Math.max(0, Math.floor(score * percent / 100));
}

/**
 * Check if three tiles can all be matched together (triple match).
 * All 3 pairs must be able to connect with ≤2 turns each.
 */
export function canTripleMatch(
  board: (string | null)[],
  pos1: LinkGamePosition,
  pos2: LinkGamePosition,
  pos3: LinkGamePosition,
  cols: number
): boolean {
  const tile1 = getTile(board, pos1, cols);
  const tile2 = getTile(board, pos2, cols);
  const tile3 = getTile(board, pos3, cols);
  
  if (tile1 === null || tile2 === null || tile3 === null) return false;
  if (tile1 !== tile2 || tile2 !== tile3) return false;
  
  return (
    canMatch(board, pos1, pos2, cols) &&
    canMatch(board, pos1, pos3, cols) &&
    canMatch(board, pos2, pos3, cols)
  );
}

/**
 * Remove three tiles from the board (triple match).
 */
export function removeTripleMatch(
  board: (string | null)[],
  pos1: LinkGamePosition,
  pos2: LinkGamePosition,
  pos3: LinkGamePosition,
  cols: number
): (string | null)[] {
  const newBoard = [...board];
  const idx1 = indexOf(pos1, cols);
  const idx2 = indexOf(pos2, cols);
  const idx3 = indexOf(pos3, cols);
  newBoard[idx1] = null;
  newBoard[idx2] = null;
  newBoard[idx3] = null;
  return newBoard;
}
