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

export const WHACK_MOLE_DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type WhackMoleDifficulty = typeof WHACK_MOLE_DIFFICULTIES[number];

export interface WhackMoleDifficultyConfig {
  label: string;
  shortLabel: string;
  description: string;
  durationMs: number;
  startRefreshMs: number;
  endRefreshMs: number;
  minBombs: number;
  maxBombs: number;
  normalPoints: number;
  goldenPoints: number;
  bombPenalty: number;
  comboBonusStep: number;
  maxComboBonus: number;
  winScore: number;
  rewardDivisor: number;
  activeTargetBase: number;
  activeTargetGrowthSeconds: number;
  activeTargetMax: number;
  extraTargetThreshold: number;
  goldenThreshold: number;
}

export const WHACK_MOLE_DIFFICULTY_CONFIG: Record<WhackMoleDifficulty, WhackMoleDifficultyConfig> = {
  easy: {
    label: '简单',
    shortLabel: '轻松',
    description: '节奏更慢、炸弹更少，适合热身和手机小屏游玩。',
    durationMs: 45_000,
    startRefreshMs: 1400,
    endRefreshMs: 760,
    minBombs: 0,
    maxBombs: 2,
    normalPoints: 10,
    goldenPoints: 30,
    bombPenalty: 20,
    comboBonusStep: 1,
    maxComboBonus: 18,
    winScore: 800,
    rewardDivisor: 12,
    activeTargetBase: 1,
    activeTargetGrowthSeconds: 20,
    activeTargetMax: 4,
    extraTargetThreshold: 0.82,
    goldenThreshold: 0.88,
  },
  normal: {
    label: '普通',
    shortLabel: '标准',
    description: '当前标准规则，速度和奖励最均衡。',
    durationMs: 60_000,
    startRefreshMs: 1250,
    endRefreshMs: 560,
    minBombs: 0,
    maxBombs: 4,
    normalPoints: 10,
    goldenPoints: 35,
    bombPenalty: 25,
    comboBonusStep: 2,
    maxComboBonus: 30,
    winScore: 1200,
    rewardDivisor: 10,
    activeTargetBase: 2,
    activeTargetGrowthSeconds: 18,
    activeTargetMax: 5,
    extraTargetThreshold: 0.78,
    goldenThreshold: 0.86,
  },
  hard: {
    label: '困难',
    shortLabel: '高压',
    description: '刷新更快、炸弹更多，连击和积分收益也更高。',
    durationMs: 60_000,
    startRefreshMs: 980,
    endRefreshMs: 420,
    minBombs: 0,
    maxBombs: 6,
    normalPoints: 12,
    goldenPoints: 45,
    bombPenalty: 35,
    comboBonusStep: 3,
    maxComboBonus: 45,
    winScore: 1500,
    rewardDivisor: 8,
    activeTargetBase: 2,
    activeTargetGrowthSeconds: 14,
    activeTargetMax: 6,
    extraTargetThreshold: 0.68,
    goldenThreshold: 0.82,
  },
};

export const WHACK_MOLE_BOARD_SIZE = 4;
export const WHACK_MOLE_HOLE_COUNT = WHACK_MOLE_BOARD_SIZE * WHACK_MOLE_BOARD_SIZE;
export const WHACK_MOLE_GAME_DURATION_MS = WHACK_MOLE_DIFFICULTY_CONFIG.normal.durationMs;
export const WHACK_MOLE_START_REFRESH_MS = WHACK_MOLE_DIFFICULTY_CONFIG.normal.startRefreshMs;
export const WHACK_MOLE_END_REFRESH_MS = WHACK_MOLE_DIFFICULTY_CONFIG.normal.endRefreshMs;
export const WHACK_MOLE_MIN_BOMBS = WHACK_MOLE_DIFFICULTY_CONFIG.normal.minBombs;
export const WHACK_MOLE_MAX_BOMBS = WHACK_MOLE_DIFFICULTY_CONFIG.normal.maxBombs;
export const WHACK_MOLE_NORMAL_POINTS = WHACK_MOLE_DIFFICULTY_CONFIG.normal.normalPoints;
export const WHACK_MOLE_GOLDEN_POINTS = WHACK_MOLE_DIFFICULTY_CONFIG.normal.goldenPoints;
export const WHACK_MOLE_BOMB_PENALTY = WHACK_MOLE_DIFFICULTY_CONFIG.normal.bombPenalty;
export const WHACK_MOLE_COMBO_BONUS_STEP = WHACK_MOLE_DIFFICULTY_CONFIG.normal.comboBonusStep;
export const WHACK_MOLE_MAX_COMBO_BONUS = WHACK_MOLE_DIFFICULTY_CONFIG.normal.maxComboBonus;
export const WHACK_MOLE_MAX_EVENTS = 420;
export const WHACK_MOLE_MAX_EVENTS_PER_SECOND = 16;
export const WHACK_MOLE_WIN_SCORE = WHACK_MOLE_DIFFICULTY_CONFIG.normal.winScore;

export function normalizeWhackMoleDifficulty(value: unknown): WhackMoleDifficulty {
  return WHACK_MOLE_DIFFICULTIES.includes(value as WhackMoleDifficulty)
    ? value as WhackMoleDifficulty
    : 'normal';
}

export function getWhackMoleDifficultyConfig(
  difficulty: WhackMoleDifficulty = 'normal',
): WhackMoleDifficultyConfig {
  return WHACK_MOLE_DIFFICULTY_CONFIG[normalizeWhackMoleDifficulty(difficulty)];
}

export function createEmptyWhackMoleBoard(): WhackMoleCell[] {
  return Array.from({ length: WHACK_MOLE_HOLE_COUNT }, () => 'empty' as WhackMoleCell);
}

function clampProgress(elapsedMs: number, difficulty: WhackMoleDifficulty = 'normal'): number {
  if (!Number.isFinite(elapsedMs)) {
    return 0;
  }
  const config = getWhackMoleDifficultyConfig(difficulty);
  return Math.min(1, Math.max(0, elapsedMs / config.durationMs));
}

export function getWhackMoleRefreshMs(
  elapsedMs: number,
  difficulty: WhackMoleDifficulty = 'normal',
): number {
  const config = getWhackMoleDifficultyConfig(difficulty);
  const progress = clampProgress(elapsedMs, difficulty);
  return Math.round(
    config.startRefreshMs
      + (config.endRefreshMs - config.startRefreshMs) * progress,
  );
}

export function getWhackMoleTickIndex(
  elapsedMs: number,
  difficulty: WhackMoleDifficulty = 'normal',
): number {
  if (!Number.isFinite(elapsedMs)) {
    return 0;
  }

  const config = getWhackMoleDifficultyConfig(difficulty);
  const targetMs = Math.min(Math.max(0, elapsedMs), config.durationMs - 1);
  let cursorMs = 0;
  let tickIndex = 0;

  while (cursorMs + getWhackMoleRefreshMs(cursorMs, difficulty) <= targetMs) {
    cursorMs += getWhackMoleRefreshMs(cursorMs, difficulty);
    tickIndex += 1;
  }

  return tickIndex;
}

export function getWhackMoleBombCount(
  elapsedMs: number,
  difficulty: WhackMoleDifficulty = 'normal',
): number {
  const config = getWhackMoleDifficultyConfig(difficulty);
  const progress = clampProgress(elapsedMs, difficulty);
  return Math.min(
    config.maxBombs,
    Math.floor(
      config.minBombs
        + (config.maxBombs + 1 - config.minBombs) * progress,
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

export function getWhackMoleBoard(
  seed: string,
  elapsedMs: number,
  difficulty: WhackMoleDifficulty = 'normal',
): WhackMoleCell[] {
  const config = getWhackMoleDifficultyConfig(difficulty);
  const tickIndex = getWhackMoleTickIndex(elapsedMs, difficulty);
  const rng = seedrandom(`${seed}:board:${tickIndex}`);
  const elapsedSeconds = Math.min(config.durationMs / 1000, Math.max(0, elapsedMs / 1000));
  const board = createEmptyWhackMoleBoard();
  const indexes = shuffleIndexes(seed, tickIndex);

  // 难度随时间增长：目标数量小幅提升，刷新速度和炸弹数量按时间线性变化。
  const activeCount = Math.min(
    config.activeTargetMax,
    config.activeTargetBase
      + Math.floor(elapsedSeconds / config.activeTargetGrowthSeconds)
      + (rng() > config.extraTargetThreshold ? 1 : 0),
  );

  for (let index = 0; index < activeCount; index += 1) {
    board[indexes[index]] = rng() > config.goldenThreshold ? 'golden' : 'mole';
  }

  const bombCount = Math.min(
    WHACK_MOLE_HOLE_COUNT - activeCount,
    getWhackMoleBombCount(elapsedMs, difficulty),
  );
  for (let index = 0; index < bombCount; index += 1) {
    const boardIndex = indexes[activeCount + index];
    if (boardIndex !== undefined) {
      board[boardIndex] = 'bomb';
    }
  }

  return board;
}

export function getWhackMoleScoreDelta(
  cell: WhackMoleCell,
  comboBefore: number,
  difficulty: WhackMoleDifficulty = 'normal',
): number {
  const config = getWhackMoleDifficultyConfig(difficulty);
  if (cell === 'bomb') {
    return -config.bombPenalty;
  }

  if (cell !== 'mole' && cell !== 'golden') {
    return 0;
  }

  const nextCombo = comboBefore + 1;
  const comboBonus = Math.min(
    config.maxComboBonus,
    Math.max(0, nextCombo - 1) * config.comboBonusStep,
  );
  const base = cell === 'golden' ? config.goldenPoints : config.normalPoints;
  return base + comboBonus;
}

export function scoreWhackMoleEvents(
  seed: string,
  events: WhackMoleHitEvent[],
  difficulty: WhackMoleDifficulty = 'normal',
): WhackMoleScoreResult {
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
    const tickIndex = getWhackMoleTickIndex(event.elapsedMs, difficulty);
    const targetKey = `${tickIndex}:${event.index}`;
    const board = getWhackMoleBoard(seed, event.elapsedMs, difficulty);
    const cell = board[event.index] ?? 'empty';

    if ((cell === 'mole' || cell === 'golden') && !consumedTargets.has(targetKey)) {
      const delta = getWhackMoleScoreDelta(cell, combo, difficulty);
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
      const nextScore = Math.max(0, score - getWhackMoleDifficultyConfig(difficulty).bombPenalty);
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

export function calculateWhackMolePointReward(
  score: number,
  difficulty: WhackMoleDifficulty = 'normal',
): number {
  const config = getWhackMoleDifficultyConfig(difficulty);
  return Math.max(0, Math.floor(score / config.rewardDivisor));
}
