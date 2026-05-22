import seedrandom from 'seedrandom';

export type WhackMoleCell = 'empty' | 'mole' | 'golden' | 'bomb';
export type WhackMoleHitResult = 'hit' | 'golden_hit' | 'bomb' | 'miss' | 'duplicate';

export interface WhackMoleHitEvent {
  index: number;
  elapsedMs: number;
}

export interface WhackMoleScoredEvent extends WhackMoleHitEvent {
  tickIndex: number;
  cell: WhackMoleCell;
  result: WhackMoleHitResult;
  scoreDelta: number;
  comboAfter: number;
}

export interface WhackMoleScoreStats {
  hits: number;
  goldenHits: number;
  misses: number;
  bombs: number;
  maxCombo: number;
}

export interface WhackMoleScoreResult {
  score: number;
  combo: number;
  stats: WhackMoleScoreStats;
  events: WhackMoleScoredEvent[];
}

export const WHACK_MOLE_BOARD_SIZE = 4;
export const WHACK_MOLE_HOLE_COUNT = WHACK_MOLE_BOARD_SIZE * WHACK_MOLE_BOARD_SIZE;
export const WHACK_MOLE_GAME_DURATION_MS = 60_000;
export const WHACK_MOLE_START_REFRESH_MS = 1250;
export const WHACK_MOLE_END_REFRESH_MS = 560;
export const WHACK_MOLE_MIN_BOMBS = 0;
export const WHACK_MOLE_MAX_BOMBS = 4;
export const WHACK_MOLE_NORMAL_POINTS = 10;
export const WHACK_MOLE_GOLDEN_POINTS = 35;
export const WHACK_MOLE_BOMB_PENALTY = 25;
export const WHACK_MOLE_COMBO_BONUS_STEP = 2;
export const WHACK_MOLE_MAX_COMBO_BONUS = 30;
export const WHACK_MOLE_MAX_EVENTS = 420;
export const WHACK_MOLE_MAX_EVENTS_PER_SECOND = 16;
export const WHACK_MOLE_WIN_SCORE = 800;

const GAME_DURATION_SECONDS = WHACK_MOLE_GAME_DURATION_MS / 1000;

export function createEmptyWhackMoleBoard(): WhackMoleCell[] {
  return Array.from({ length: WHACK_MOLE_HOLE_COUNT }, () => 'empty' as WhackMoleCell);
}

function clampProgress(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) {
    return 0;
  }
  return Math.min(1, Math.max(0, elapsedMs / WHACK_MOLE_GAME_DURATION_MS));
}

export function getWhackMoleRefreshMs(elapsedMs: number): number {
  const progress = clampProgress(elapsedMs);
  return Math.round(
    WHACK_MOLE_START_REFRESH_MS
      + (WHACK_MOLE_END_REFRESH_MS - WHACK_MOLE_START_REFRESH_MS) * progress,
  );
}

export function getWhackMoleTickIndex(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) {
    return 0;
  }

  const targetMs = Math.min(Math.max(0, elapsedMs), WHACK_MOLE_GAME_DURATION_MS - 1);
  let cursorMs = 0;
  let tickIndex = 0;

  while (cursorMs + getWhackMoleRefreshMs(cursorMs) <= targetMs) {
    cursorMs += getWhackMoleRefreshMs(cursorMs);
    tickIndex += 1;
  }

  return tickIndex;
}

export function getWhackMoleBombCount(elapsedMs: number): number {
  const progress = clampProgress(elapsedMs);
  return Math.min(
    WHACK_MOLE_MAX_BOMBS,
    Math.floor(
      WHACK_MOLE_MIN_BOMBS
        + (WHACK_MOLE_MAX_BOMBS + 1 - WHACK_MOLE_MIN_BOMBS) * progress,
    ),
  );
}

function shuffleIndexes(seed: string, tickIndex: number): number[] {
  const rng = seedrandom(`${seed}:whack:${tickIndex}`);
  const indexes = Array.from({ length: WHACK_MOLE_HOLE_COUNT }, (_, index) => index);

  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }

  return indexes;
}

export function getWhackMoleBoard(seed: string, elapsedMs: number): WhackMoleCell[] {
  const tickIndex = getWhackMoleTickIndex(elapsedMs);
  const rng = seedrandom(`${seed}:board:${tickIndex}`);
  const elapsedSeconds = Math.min(GAME_DURATION_SECONDS, Math.max(0, elapsedMs / 1000));
  const board = createEmptyWhackMoleBoard();
  const indexes = shuffleIndexes(seed, tickIndex);

  // 难度随时间增长：目标数量小幅提升，刷新速度和炸弹数量按时间线性变化。
  const activeCount = Math.min(
    5,
    2 + Math.floor(elapsedSeconds / 18) + (rng() > 0.78 ? 1 : 0),
  );

  for (let index = 0; index < activeCount; index += 1) {
    board[indexes[index]] = rng() > 0.86 ? 'golden' : 'mole';
  }

  const bombCount = Math.min(
    WHACK_MOLE_HOLE_COUNT - activeCount,
    getWhackMoleBombCount(elapsedMs),
  );
  for (let index = 0; index < bombCount; index += 1) {
    const boardIndex = indexes[activeCount + index];
    if (boardIndex !== undefined) {
      board[boardIndex] = 'bomb';
    }
  }

  return board;
}

export function getWhackMoleScoreDelta(cell: WhackMoleCell, comboBefore: number): number {
  if (cell === 'bomb') {
    return -WHACK_MOLE_BOMB_PENALTY;
  }

  if (cell !== 'mole' && cell !== 'golden') {
    return 0;
  }

  const nextCombo = comboBefore + 1;
  const comboBonus = Math.min(
    WHACK_MOLE_MAX_COMBO_BONUS,
    Math.max(0, nextCombo - 1) * WHACK_MOLE_COMBO_BONUS_STEP,
  );
  const base = cell === 'golden' ? WHACK_MOLE_GOLDEN_POINTS : WHACK_MOLE_NORMAL_POINTS;
  return base + comboBonus;
}

export function scoreWhackMoleEvents(seed: string, events: WhackMoleHitEvent[]): WhackMoleScoreResult {
  let score = 0;
  let combo = 0;
  const consumedTargets = new Set<string>();
  const scoredEvents: WhackMoleScoredEvent[] = [];
  const stats: WhackMoleScoreStats = {
    hits: 0,
    goldenHits: 0,
    misses: 0,
    bombs: 0,
    maxCombo: 0,
  };

  for (const event of events) {
    const tickIndex = getWhackMoleTickIndex(event.elapsedMs);
    const targetKey = `${tickIndex}:${event.index}`;
    const board = getWhackMoleBoard(seed, event.elapsedMs);
    const cell = board[event.index] ?? 'empty';

    if ((cell === 'mole' || cell === 'golden') && !consumedTargets.has(targetKey)) {
      const delta = getWhackMoleScoreDelta(cell, combo);
      combo += 1;
      score += delta;
      stats.hits += 1;
      stats.maxCombo = Math.max(stats.maxCombo, combo);
      if (cell === 'golden') {
        stats.goldenHits += 1;
      }
      consumedTargets.add(targetKey);
      scoredEvents.push({
        ...event,
        tickIndex,
        cell,
        result: cell === 'golden' ? 'golden_hit' : 'hit',
        scoreDelta: delta,
        comboAfter: combo,
      });
      continue;
    }

    if ((cell === 'mole' || cell === 'golden') && consumedTargets.has(targetKey)) {
      combo = 0;
      stats.misses += 1;
      scoredEvents.push({
        ...event,
        tickIndex,
        cell,
        result: 'duplicate',
        scoreDelta: 0,
        comboAfter: combo,
      });
      continue;
    }

    if (cell === 'bomb') {
      const nextScore = Math.max(0, score - WHACK_MOLE_BOMB_PENALTY);
      const delta = nextScore - score;
      score = nextScore;
      combo = 0;
      stats.bombs += 1;
      scoredEvents.push({
        ...event,
        tickIndex,
        cell,
        result: 'bomb',
        scoreDelta: delta,
        comboAfter: combo,
      });
      continue;
    }

    combo = 0;
    stats.misses += 1;
    scoredEvents.push({
      ...event,
      tickIndex,
      cell,
      result: 'miss',
      scoreDelta: 0,
      comboAfter: combo,
    });
  }

  return {
    score,
    combo,
    stats,
    events: scoredEvents,
  };
}

export function calculateWhackMolePointReward(score: number): number {
  return Math.max(0, Math.floor(score / 10));
}
