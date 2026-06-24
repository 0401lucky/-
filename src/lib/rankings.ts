import { kv } from '@/lib/d1-kv';
import { getAllUsers } from './kv';
import type { GameType } from './types/game';
import {
  getNativeCheckinEntries,
  getNativeGameLeaderboardRows,
  getNativeOverallBreakdownRows,
  getNativePointsLeaderboardRows,
  getNativePositivePointsLeaderboardRowsByRange,
  getNativeRankingCache,
  isNativeHotStoreReady,
  listNativeCheckinDates,
  setNativeRankingCache,
} from './hot-d1';
import { getCustomUserProfile } from './user-profile';
import { getEquippedAchievementForUser } from './user-achievements';
import type { PublicAchievement } from './profile-achievements';

const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_RECORD_SCAN = 200;
const MAX_POINT_HISTORY_SCAN = 2000;
const MAX_STREAK_DAYS = 400;
const ALL_GAMES_RANKING_CACHE_TTL_SECONDS = 30;
const OTHER_RANKING_CACHE_TTL_SECONDS = 30;
const OPEN_ENDED_RANGE_END = 8_640_000_000_000_000; // Date 的最大安全时间戳，避免 D1 绑定 Infinity 后查询为空
const EXCLUDED_POSITIVE_POINT_SOURCES = new Set(['admin_adjust']);

export type RankingPeriod = 'daily' | 'weekly' | 'monthly';
export type PointsRankingPeriod = 'all' | 'monthly';
export type CheckinRankingPeriod = 'all' | 'monthly';
export type SupportedRankingGame = Extract<GameType, 'linkgame' | 'match3' | 'memory' | 'whack_mole' | 'roguelite' | 'minesweeper' | 'game_2048'>;

interface BaseRecord {
  score?: number;
  pointsEarned?: number;
  createdAt?: number;
  difficulty?: string | null;
}

export interface GameLeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  // 个人主页设置的自定义昵称；未设置或缓存命中旧数据时为 undefined/null
  displayName?: string | null;
  // 个人主页设置的自定义头像（http(s) URL 或 data:image/* base64）
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
  gameType: SupportedRankingGame;
  totalScore: number;
  totalPoints: number;
  bestScore: number;
  gamesPlayed: number;
}

export interface GameDifficultyOption {
  value: string;
  label: string;
}

export interface GameRankingResult {
  gameType: SupportedRankingGame;
  leaderboard: GameLeaderboardEntry[];
  selectedDifficulty?: string | null;
  difficultyOptions?: GameDifficultyOption[];
  leaderboardsByDifficulty?: Record<string, GameLeaderboardEntry[]>;
}

export interface OverallLeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
  totalScore: number;
  totalPoints: number;
  gamesPlayed: number;
  gameBreakdown: Partial<Record<SupportedRankingGame, { score: number; points: number; games: number }>>;
}

export interface AllGamesRankingResult {
  period: RankingPeriod;
  generatedAt: number;
  startAt: number;
  games: GameRankingResult[];
  overall: OverallLeaderboardEntry[];
}

export interface AllGamesRankingSnapshot {
  generatedAt: number;
  startAt: number;
  endAt: number;
  games: GameRankingResult[];
  overall: OverallLeaderboardEntry[];
}

export interface MonthlyPeakHistoryItem {
  monthKey: string;
  monthLabel: string;
  startAt: number;
  endAt: number;
  leaderboard: Array<PointsLeaderboardEntry & {
    displayName: string | null;
    avatarUrl: string | null;
    equippedAchievement: PublicAchievement | null;
  }>;
}

export interface MonthlyPeakHistoryResult {
  generatedAt: number;
  months: MonthlyPeakHistoryItem[];
  topLimit: number;
}

export interface PointsLeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
  points: number;
}

export interface CheckinStreakLeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
  streak: number;
}

const GAME_RECORD_KEY: Record<SupportedRankingGame, (userId: number) => string> = {
  linkgame: (userId) => `linkgame:records:${userId}`,
  match3: (userId) => `match3:records:${userId}`,
  memory: (userId) => `memory:records:${userId}`,
  whack_mole: (userId) => `whack_mole:records:${userId}`,
  roguelite: (userId) => `roguelite:records:${userId}`,
  minesweeper: (userId) => `minesweeper:records:${userId}`,
  game_2048: (userId) => `game_2048:records:${userId}`,
};

const ALL_DIFFICULTY_OPTION: GameDifficultyOption = { value: 'all', label: '全部难度' };

const GAME_DIFFICULTY_OPTIONS: Partial<Record<SupportedRankingGame, GameDifficultyOption[]>> = {
  linkgame: [
    { value: 'easy', label: '简单' },
    { value: 'normal', label: '普通' },
    { value: 'hard', label: '困难' },
  ],
  memory: [
    { value: 'easy', label: '简单' },
    { value: 'normal', label: '普通' },
    { value: 'hard', label: '困难' },
  ],
  whack_mole: [
    { value: 'easy', label: '简单' },
    { value: 'normal', label: '普通' },
    { value: 'hard', label: '困难' },
  ],
  minesweeper: [
    { value: 'easy', label: '简单' },
    { value: 'normal', label: '普通' },
    { value: 'hard', label: '困难' },
  ],
};

function getChinaDate(date: Date = new Date()): Date {
  return new Date(date.getTime() + CHINA_TZ_OFFSET_MS);
}

function formatChinaDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function chinaDayStartToUtc(chinaDate: Date): number {
  const start = new Date(chinaDate);
  start.setUTCHours(0, 0, 0, 0);
  return start.getTime() - CHINA_TZ_OFFSET_MS;
}

function getPeriodStartUtc(period: RankingPeriod): number {
  const chinaNow = getChinaDate();
  const start = new Date(chinaNow);

  if (period === 'daily') {
    start.setUTCHours(0, 0, 0, 0);
    return start.getTime() - CHINA_TZ_OFFSET_MS;
  }

  if (period === 'weekly') {
    start.setUTCHours(0, 0, 0, 0);
    const day = start.getUTCDay(); // 0=Sunday
    const diffToMonday = day === 0 ? 6 : day - 1;
    start.setUTCDate(start.getUTCDate() - diffToMonday);
    return start.getTime() - CHINA_TZ_OFFSET_MS;
  }

  // monthly
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start.getTime() - CHINA_TZ_OFFSET_MS;
}

function toFiniteNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function ensurePositiveInteger(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.floor(num)) : 0;
}

function normalizeRangeEndAt(endAt: number): number {
  return Number.isFinite(endAt) ? endAt : OPEN_ENDED_RANGE_END;
}

function sortByScore<T extends { totalScore: number; totalPoints: number; gamesPlayed: number; userId: number }>(
  list: T[]
): T[] {
  return [...list].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
    return a.userId - b.userId;
  });
}

function sortByBestScore<T extends { bestScore: number; totalPoints: number; gamesPlayed: number; userId: number }>(
  list: T[]
): T[] {
  return [...list].sort((a, b) => {
    if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (a.gamesPlayed !== b.gamesPlayed) return a.gamesPlayed - b.gamesPlayed;
    return a.userId - b.userId;
  });
}

function getDifficultyOptions(gameType: SupportedRankingGame, includeAll = false): GameDifficultyOption[] {
  const options = GAME_DIFFICULTY_OPTIONS[gameType] ?? [];
  return includeAll && options.length > 0 ? [ALL_DIFFICULTY_OPTION, ...options] : options;
}

function normalizeDifficultyFilter(gameType: SupportedRankingGame, value?: string | null): string | undefined {
  if (!value || value === ALL_DIFFICULTY_OPTION.value) {
    return undefined;
  }

  const options = getDifficultyOptions(gameType);
  return options.some((option) => option.value === value) ? value : undefined;
}

function normalizeRecordDifficulty(gameType: SupportedRankingGame, value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const options = getDifficultyOptions(gameType);
  if (options.some((option) => option.value === raw)) {
    return raw;
  }

  // 旧游戏记录没有 difficulty 字段，统一归入普通难度，避免历史成绩丢失。
  return 'normal';
}

function getAllGamesLeaderboardCacheKey(
  period: RankingPeriod,
  options: { limitPerGame?: number; overallLimit?: number },
): string {
  const limitPerGame = Math.max(1, Math.min(100, Math.floor(options.limitPerGame ?? 20)));
  const overallLimit = Math.max(1, Math.min(100, Math.floor(options.overallLimit ?? 20)));
  return `rankings:all-games:v2-best:${period}:${limitPerGame}:${overallLimit}`;
}

function getPointsRankingCacheKey(period: PointsRankingPeriod, limit: number): string {
  return `rankings:points:v2:${period}:${Math.max(1, Math.min(100, Math.floor(limit)))}`;
}

function getCheckinRankingCacheKey(period: CheckinRankingPeriod, limit: number): string {
  return `rankings:checkin:${period}:${Math.max(1, Math.min(100, Math.floor(limit)))}`;
}

/**
 * 给排行榜条目附加自定义昵称和头像（来自 user-profile KV）。
 * 排行榜的本体计算/缓存层只关心打分数据，自定义资料每次查询时按需注入，
 * 这样个人主页改了昵称/头像，下一次拉取就能立刻反映出来。
 */
async function enrichEntriesWithProfile<T extends { userId: number }>(
  entries: T[],
): Promise<Array<T & { displayName: string | null; avatarUrl: string | null; equippedAchievement: PublicAchievement | null }>> {
  if (entries.length === 0) {
    return [] as Array<T & { displayName: string | null; avatarUrl: string | null; equippedAchievement: PublicAchievement | null }>;
  }
  const profiles = await Promise.all(
    entries.map(async (entry) => {
      const [profile, equippedAchievement] = await Promise.all([
        getCustomUserProfile(entry.userId),
        getEquippedAchievementForUser(entry.userId),
      ]);
      return { profile, equippedAchievement };
    })
  );
  return entries.map((entry, index) => ({
    ...entry,
    displayName: profiles[index].profile.displayName ?? null,
    avatarUrl: profiles[index].profile.avatarUrl ?? null,
    equippedAchievement: profiles[index].equippedAchievement,
  }));
}

function formatChinaDateFromOffset(base: Date, offset: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - offset);
  return formatChinaDate(d);
}

function computeStreakFromDateSet(dateSet: Set<string>, chinaNow: Date, dayCount: number): number {
  if (dayCount <= 0) return 0;

  let startOffset = 0;
  const today = formatChinaDateFromOffset(chinaNow, 0);
  const yesterday = formatChinaDateFromOffset(chinaNow, 1);
  if (!dateSet.has(today)) {
    if (!dateSet.has(yesterday)) {
      return 0;
    }
    startOffset = 1;
  }

  let streak = 0;
  for (let offset = startOffset; offset < dayCount; offset += 1) {
    const date = formatChinaDateFromOffset(chinaNow, offset);
    if (!dateSet.has(date)) break;
    streak += 1;
  }

  return streak;
}

function isEligiblePositivePointIncome(
  item: { amount?: number; createdAt?: number; source?: string | null } | null | undefined,
  startAt: number,
  endAt: number = Number.POSITIVE_INFINITY,
): boolean {
  const createdAt = toFiniteNumber(item?.createdAt);
  if (createdAt < startAt || createdAt >= endAt) return false;
  const amount = toFiniteNumber(item?.amount);
  if (amount <= 0) return false;
  return !EXCLUDED_POSITIVE_POINT_SOURCES.has(String(item?.source ?? ''));
}

async function getRecordsInPeriod(
  userId: number,
  gameType: SupportedRankingGame,
  startAt: number,
  endAt: number = Number.POSITIVE_INFINITY,
  difficulty?: string | null,
): Promise<BaseRecord[]> {
  const key = GAME_RECORD_KEY[gameType](userId);
  const records = await kv.lrange<BaseRecord>(key, 0, MAX_RECORD_SCAN - 1);
  if (!Array.isArray(records)) return [];

  const difficultyFilter = normalizeDifficultyFilter(gameType, difficulty);
  return records.filter((record) => {
    if (!record || typeof record !== 'object') return false;
    const createdAt = toFiniteNumber(record.createdAt);
    if (createdAt < startAt || createdAt >= endAt) return false;
    if (!difficultyFilter) return true;
    return normalizeRecordDifficulty(gameType, record.difficulty) === difficultyFilter;
  });
}

async function getGameLeaderboardByRange(
  gameType: SupportedRankingGame,
  startAt: number,
  endAt: number,
  limit = 20,
  difficulty?: string | null,
): Promise<GameLeaderboardEntry[]> {
  const difficultyFilter = normalizeDifficultyFilter(gameType, difficulty);
  if (await isNativeHotStoreReady()) {
    const rows = await getNativeGameLeaderboardRows(
      gameType,
      startAt,
      normalizeRangeEndAt(endAt),
      limit,
      difficultyFilter,
    );
    return rows.map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      username: row.username,
      gameType,
      totalScore: row.totalScore,
      totalPoints: row.totalPoints,
      bestScore: row.bestScore,
      gamesPlayed: row.gamesPlayed,
    }));
  }

  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const users = await getAllUsers();

  const validUsers = users
    .map((user) => ({ id: ensurePositiveInteger(user.id), username: user.username }))
    .filter((u) => u.id > 0);

  const allRecords = await Promise.all(
    validUsers.map((u) => getRecordsInPeriod(u.id, gameType, startAt, endAt, difficultyFilter))
  );

  const rows: Omit<GameLeaderboardEntry, 'rank'>[] = [];
  for (let i = 0; i < validUsers.length; i++) {
    const records = allRecords[i];
    if (records.length === 0) continue;
    const user = validUsers[i];

    rows.push({
      userId: user.id,
      username: user.username || `#${user.id}`,
      gameType,
      totalScore: records.reduce((sum, r) => sum + toFiniteNumber(r.score), 0),
      totalPoints: records.reduce((sum, r) => sum + toFiniteNumber(r.pointsEarned), 0),
      bestScore: records.reduce((max, r) => Math.max(max, toFiniteNumber(r.score)), 0),
      gamesPlayed: records.length,
    });
  }

  return sortByBestScore(rows)
    .slice(0, safeLimit)
    .map((item, index) => ({
      rank: index + 1,
      ...item,
    }));
}

export async function getGameLeaderboard(
  gameType: SupportedRankingGame,
  period: RankingPeriod,
  limit = 20,
  difficulty?: string | null,
): Promise<GameLeaderboardEntry[]> {
  const startAt = getPeriodStartUtc(period);
  const base = await getGameLeaderboardByRange(
    gameType,
    startAt,
    Number.POSITIVE_INFINITY,
    limit,
    difficulty,
  );
  return enrichEntriesWithProfile(base);
}

export async function getAllGamesLeaderboardByRange(
  startAt: number,
  endAt: number,
  options: { limitPerGame?: number; overallLimit?: number } = {}
): Promise<AllGamesRankingSnapshot> {
  const limitPerGame = Math.max(1, Math.min(100, Math.floor(options.limitPerGame ?? 20)));
  const overallLimit = Math.max(1, Math.min(100, Math.floor(options.overallLimit ?? 20)));

  const gameTypes: SupportedRankingGame[] = ['linkgame', 'match3', 'memory', 'whack_mole', 'roguelite', 'minesweeper', 'game_2048'];

  const allLeaderboards = await Promise.all(
    gameTypes.map((gameType) => getGameLeaderboardByRange(gameType, startAt, endAt, limitPerGame))
  );

  const difficultyLeaderboards = await Promise.all(
    gameTypes.map(async (gameType, index) => {
      const options = getDifficultyOptions(gameType);
      if (options.length === 0) {
        return null;
      }

      const entries = await Promise.all(
        options.map((option) => getGameLeaderboardByRange(
          gameType,
          startAt,
          endAt,
          limitPerGame,
          option.value,
        ))
      );
      return options.reduce<Record<string, GameLeaderboardEntry[]>>(
        (acc, option, optionIndex) => {
          acc[option.value] = entries[optionIndex];
          return acc;
        },
        { [ALL_DIFFICULTY_OPTION.value]: allLeaderboards[index] },
      );
    })
  );

  const gameResults: GameRankingResult[] = gameTypes.map((gameType, i) => {
    const options = getDifficultyOptions(gameType, true);
    return {
      gameType,
      leaderboard: allLeaderboards[i],
      selectedDifficulty: options.length > 0 ? ALL_DIFFICULTY_OPTION.value : null,
      difficultyOptions: options.length > 0 ? options : undefined,
      leaderboardsByDifficulty: difficultyLeaderboards[i] ?? undefined,
    };
  });

  const overallMap = new Map<number, Omit<OverallLeaderboardEntry, 'rank'>>();

  if (await isNativeHotStoreReady()) {
    const nativeRows = await getNativeOverallBreakdownRows(startAt, normalizeRangeEndAt(endAt));
    for (const row of nativeRows) {
      if (!gameTypes.includes(row.gameType as SupportedRankingGame)) {
        continue;
      }
      const gameType = row.gameType as SupportedRankingGame;
      const current = overallMap.get(row.userId) ?? {
        userId: row.userId,
        username: row.username,
        totalScore: 0,
        totalPoints: 0,
        gamesPlayed: 0,
        gameBreakdown: {},
      };

      current.totalScore += row.totalScore;
      current.totalPoints += row.totalPoints;
      current.gamesPlayed += row.gamesPlayed;
      current.gameBreakdown[gameType] = {
        score: row.totalScore,
        points: row.totalPoints,
        games: row.gamesPlayed,
      };
      overallMap.set(row.userId, current);
    }
  } else {
    for (let i = 0; i < gameTypes.length; i++) {
      const gameType = gameTypes[i];
      for (const entry of allLeaderboards[i]) {
        const current = overallMap.get(entry.userId) ?? {
          userId: entry.userId,
          username: entry.username,
          totalScore: 0,
          totalPoints: 0,
          gamesPlayed: 0,
          gameBreakdown: {},
        };

        current.totalScore += entry.totalScore;
        current.totalPoints += entry.totalPoints;
        current.gamesPlayed += entry.gamesPlayed;
        current.gameBreakdown[gameType] = {
          score: entry.totalScore,
          points: entry.totalPoints,
          games: entry.gamesPlayed,
        };

        overallMap.set(entry.userId, current);
      }
    }
  }

  const overall = sortByScore(Array.from(overallMap.values()))
    .slice(0, overallLimit)
    .map((entry, index) => ({
      rank: index + 1,
      ...entry,
    }));

  return {
    generatedAt: Date.now(),
    startAt,
    endAt,
    games: gameResults,
    overall,
  };
}

export async function getAllGamesLeaderboard(
  period: RankingPeriod,
  options: { limitPerGame?: number; overallLimit?: number } = {}
): Promise<AllGamesRankingResult> {
  const startAt = getPeriodStartUtc(period);
  const cacheKey = getAllGamesLeaderboardCacheKey(period, options);
  if (await isNativeHotStoreReady()) {
    const cached = await getNativeRankingCache<AllGamesRankingResult>(cacheKey);
    if (cached && Array.isArray(cached.games) && Array.isArray(cached.overall)) {
      return enrichAllGamesResult(cached);
    }

    const snapshot = await getAllGamesLeaderboardByRange(
      startAt,
      Number.POSITIVE_INFINITY,
      options,
    );

    const result: AllGamesRankingResult = {
      period,
      generatedAt: snapshot.generatedAt,
      startAt,
      games: snapshot.games,
      overall: snapshot.overall,
    };

    await setNativeRankingCache(
      cacheKey,
      'games',
      period,
      ALL_GAMES_RANKING_CACHE_TTL_SECONDS,
      result,
    );
    return enrichAllGamesResult(result);
  }

  const cached = await kv.get<AllGamesRankingResult>(cacheKey);
  if (cached && Array.isArray(cached.games) && Array.isArray(cached.overall)) {
    return enrichAllGamesResult(cached);
  }

  const snapshot = await getAllGamesLeaderboardByRange(
    startAt,
    Number.POSITIVE_INFINITY,
    options,
  );

  const result: AllGamesRankingResult = {
    period,
    generatedAt: snapshot.generatedAt,
    startAt,
    games: snapshot.games,
    overall: snapshot.overall,
  };

  await kv.set(cacheKey, result, { ex: ALL_GAMES_RANKING_CACHE_TTL_SECONDS });
  return enrichAllGamesResult(result);
}

async function enrichAllGamesResult(result: AllGamesRankingResult): Promise<AllGamesRankingResult> {
  const [enrichedOverall, ...enrichedGameGroups] = await Promise.all([
    enrichEntriesWithProfile(result.overall),
    ...result.games.map(async (group) => {
      const leaderboard = await enrichEntriesWithProfile(group.leaderboard);
      if (!group.leaderboardsByDifficulty) {
        return { ...group, leaderboard };
      }

      const enrichedDifficultyPairs = await Promise.all(
        Object.entries(group.leaderboardsByDifficulty).map(async ([difficulty, entries]) => [
          difficulty,
          await enrichEntriesWithProfile(entries),
        ] as const)
      );

      return {
        ...group,
        leaderboard,
        leaderboardsByDifficulty: Object.fromEntries(enrichedDifficultyPairs),
      };
    }),
  ]);
  return {
    ...result,
    overall: enrichedOverall,
    games: enrichedGameGroups,
  };
}

function getMonthlyStartUtc(): number {
  const chinaNow = getChinaDate();
  chinaNow.setUTCDate(1);
  chinaNow.setUTCHours(0, 0, 0, 0);
  return chinaNow.getTime() - CHINA_TZ_OFFSET_MS;
}

function formatChinaMonthKey(chinaDate: Date): string {
  const year = chinaDate.getUTCFullYear();
  const month = String(chinaDate.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function formatChinaMonthLabel(chinaDate: Date): string {
  return `${chinaDate.getUTCFullYear()} 年 ${chinaDate.getUTCMonth() + 1} 月`;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function getCompletedMonthRanges(
  monthCount: number,
  referenceTime: number = Date.now(),
): Array<{ monthKey: string; monthLabel: string; startAt: number; endAt: number }> {
  const safeCount = clampInteger(monthCount, 12, 1, 12);
  const currentMonthStart = getChinaDate(new Date(referenceTime));
  currentMonthStart.setUTCDate(1);
  currentMonthStart.setUTCHours(0, 0, 0, 0);

  return Array.from({ length: safeCount }, (_, index) => {
    const endChina = new Date(currentMonthStart);
    endChina.setUTCMonth(currentMonthStart.getUTCMonth() - index);

    const startChina = new Date(currentMonthStart);
    startChina.setUTCMonth(currentMonthStart.getUTCMonth() - index - 1);

    return {
      monthKey: formatChinaMonthKey(startChina),
      monthLabel: formatChinaMonthLabel(startChina),
      startAt: startChina.getTime() - CHINA_TZ_OFFSET_MS,
      endAt: endChina.getTime() - CHINA_TZ_OFFSET_MS,
    };
  });
}

async function getPositivePointsLeaderboardByRange(
  startAt: number,
  endAt: number,
  limit: number,
): Promise<PointsLeaderboardEntry[]> {
  const safeLimit = clampInteger(limit, 10, 1, 100);

  if (await isNativeHotStoreReady()) {
    const rows = await getNativePositivePointsLeaderboardRowsByRange(startAt, endAt, safeLimit);
    return rows.map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      username: row.username,
      points: row.points,
    }));
  }

  const users = await getAllUsers();
  const validUsers = users
    .map((user) => ({ id: ensurePositiveInteger(user.id), username: user.username }))
    .filter((u) => u.id > 0);

  const allPoints = await Promise.all(
    validUsers.map(async (user) => {
      const logs = await kv.lrange<{ amount?: number; createdAt?: number; source?: string | null }>(
        `points_log:${user.id}`,
        0,
        MAX_POINT_HISTORY_SCAN - 1,
      );

      return (logs ?? []).reduce((sum, item) => {
        return isEligiblePositivePointIncome(item, startAt, endAt)
          ? sum + toFiniteNumber(item?.amount)
          : sum;
      }, 0);
    }),
  );

  return validUsers
    .map((user, index) => ({
      userId: user.id,
      username: user.username || `#${user.id}`,
      points: allPoints[index],
    }))
    .filter((row) => row.points > 0)
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.userId - b.userId;
    })
    .slice(0, safeLimit)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

export async function getMonthlyPeakHistory(
  options: { months?: number; topLimit?: number; referenceTime?: number } = {},
): Promise<MonthlyPeakHistoryResult> {
  const monthCount = clampInteger(options.months, 12, 1, 12);
  const topLimit = clampInteger(options.topLimit, 10, 1, 10);
  const ranges = getCompletedMonthRanges(monthCount, options.referenceTime);

  const months = await Promise.all(
    ranges.map(async (range): Promise<MonthlyPeakHistoryItem> => {
      const leaderboard = await getPositivePointsLeaderboardByRange(
        range.startAt,
        range.endAt,
        topLimit,
      );

      return {
        ...range,
        leaderboard: await enrichEntriesWithProfile(leaderboard),
      };
    }),
  );

  return {
    generatedAt: Date.now(),
    months,
    topLimit,
  };
}

export async function getPointsLeaderboard(
  period: PointsRankingPeriod = 'all',
  limit = 20,
): Promise<{ period: PointsRankingPeriod; generatedAt: number; leaderboard: PointsLeaderboardEntry[] }> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const cacheKey = getPointsRankingCacheKey(period, safeLimit);

  if (await isNativeHotStoreReady()) {
    const cached = await getNativeRankingCache<{ period: PointsRankingPeriod; generatedAt: number; leaderboard: PointsLeaderboardEntry[] }>(cacheKey);
    if (cached) {
      return { ...cached, leaderboard: await enrichEntriesWithProfile(cached.leaderboard) };
    }

    const rows = await getNativePointsLeaderboardRows(
      period,
      period === 'monthly' ? getMonthlyStartUtc() : 0,
      safeLimit,
    );
    const result = {
      period,
      generatedAt: Date.now(),
      leaderboard: rows.map((row, index) => ({
        rank: index + 1,
        userId: row.userId,
        username: row.username,
        points: row.points,
      })),
    };
    await setNativeRankingCache(cacheKey, 'points', period, OTHER_RANKING_CACHE_TTL_SECONDS, result);
    return { ...result, leaderboard: await enrichEntriesWithProfile(result.leaderboard) };
  }

  const users = await getAllUsers();

  const startAt = period === 'monthly' ? getMonthlyStartUtc() : 0;

  const validUsers = users
    .map((user) => ({ id: ensurePositiveInteger(user.id), username: user.username }))
    .filter((u) => u.id > 0);

  const allPoints = await Promise.all(
    validUsers.map(async (user) => {
      if (period === 'all') {
        return toFiniteNumber(await kv.get<number>(`points:${user.id}`));
      }
      const logs = await kv.lrange<{ amount?: number; createdAt?: number; source?: string | null }>(
        `points_log:${user.id}`,
        0,
        MAX_RECORD_SCAN - 1,
      );
      return (logs ?? []).reduce((sum, item) => {
        return isEligiblePositivePointIncome(item, startAt)
          ? sum + toFiniteNumber(item?.amount)
          : sum;
      }, 0);
    })
  );

  const rows: Array<Omit<PointsLeaderboardEntry, 'rank'>> = validUsers.map((user, i) => ({
    userId: user.id,
    username: user.username || `#${user.id}`,
    points: allPoints[i],
  }));

  const leaderboard = [...rows]
    .filter((row) => period === 'all' || row.points > 0)
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.userId - b.userId;
    })
    .slice(0, safeLimit)
    .map((row, index) => ({ rank: index + 1, ...row }));

  return {
    period,
    generatedAt: Date.now(),
    leaderboard: await enrichEntriesWithProfile(leaderboard),
  };
}

function getConsecutiveCheckinDays(
  checkinFlags: Array<unknown>,
  startIndex = 0,
): number {
  let streak = 0;
  for (let index = startIndex; index < checkinFlags.length; index += 1) {
    const flag = checkinFlags[index];
    if (!flag) break;
    streak += 1;
  }
  return streak;
}

export async function getCheckinStreak(
  userId: number,
  period: CheckinRankingPeriod = 'all',
): Promise<number> {
  if (await isNativeHotStoreReady()) {
    const chinaNow = getChinaDate();
    let dayCount = MAX_STREAK_DAYS;
    if (period === 'monthly') {
      const monthStart = new Date(chinaNow);
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const diffMs = chinaDayStartToUtc(chinaNow) - (monthStart.getTime() - CHINA_TZ_OFFSET_MS);
      dayCount = Math.min(31, Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1));
    }

    const dates = await listNativeCheckinDates(userId, dayCount + 1);
    return computeStreakFromDateSet(new Set(dates), chinaNow, dayCount);
  }

  const chinaNow = getChinaDate();

  let dayCount = MAX_STREAK_DAYS;
  if (period === 'monthly') {
    const monthStart = new Date(chinaNow);
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const diffMs = chinaDayStartToUtc(chinaNow) - (monthStart.getTime() - CHINA_TZ_OFFSET_MS);
    dayCount = Math.min(31, Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1));
  }

  const keys: string[] = [];
  for (let offset = 0; offset < dayCount; offset += 1) {
    const d = new Date(chinaNow);
    d.setUTCDate(d.getUTCDate() - offset);
    const dateStr = formatChinaDate(d);
    keys.push(`user:checkin:${userId}:${dateStr}`);
  }

  const values = keys.length > 0 ? await kv.mget<unknown[]>(...keys) : [];
  const flags = values ?? [];
  if (flags.length === 0) {
    return 0;
  }

  // 连签口径：若今天尚未签到，但昨天已签到，则从昨天起算，避免白天未签到时被误判为 0。
  const startIndex = flags[0] ? 0 : flags[1] ? 1 : -1;
  if (startIndex < 0) {
    return 0;
  }

  return getConsecutiveCheckinDays(flags, startIndex);
}

export async function getTotalCheckinDays(userId: number): Promise<number> {
  if (await isNativeHotStoreReady()) {
    const dates = await listNativeCheckinDates(userId, MAX_STREAK_DAYS);
    return new Set(dates).size;
  }

  const chinaNow = getChinaDate();
  const keys: string[] = [];
  for (let offset = 0; offset < MAX_STREAK_DAYS; offset += 1) {
    const d = new Date(chinaNow);
    d.setUTCDate(d.getUTCDate() - offset);
    const dateStr = formatChinaDate(d);
    keys.push(`user:checkin:${userId}:${dateStr}`);
  }

  const values = keys.length > 0 ? await kv.mget<unknown[]>(...keys) : [];
  const flags = values ?? [];
  let total = 0;
  for (const flag of flags) {
    if (flag) total += 1;
  }
  return total;
}

export async function getCheckinStreakLeaderboard(
  period: CheckinRankingPeriod = 'all',
  limit = 20,
): Promise<{ period: CheckinRankingPeriod; generatedAt: number; leaderboard: CheckinStreakLeaderboardEntry[] }> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const cacheKey = getCheckinRankingCacheKey(period, safeLimit);

  if (await isNativeHotStoreReady()) {
    const cached = await getNativeRankingCache<{ period: CheckinRankingPeriod; generatedAt: number; leaderboard: CheckinStreakLeaderboardEntry[] }>(cacheKey);
    if (cached) {
      return { ...cached, leaderboard: await enrichEntriesWithProfile(cached.leaderboard) };
    }

    const chinaNow = getChinaDate();
    let startDate = formatChinaDateFromOffset(chinaNow, MAX_STREAK_DAYS - 1);
    let endDate: string | undefined;
    let dayCount = MAX_STREAK_DAYS;
    if (period === 'monthly') {
      const monthStart = new Date(chinaNow);
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      startDate = formatChinaDate(monthStart);
      endDate = formatChinaDate(chinaNow);
      const diffMs = chinaDayStartToUtc(chinaNow) - (monthStart.getTime() - CHINA_TZ_OFFSET_MS);
      dayCount = Math.min(31, Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1));
    }

    const entries = await getNativeCheckinEntries(startDate, endDate);
    const grouped = new Map<number, { username: string; dates: Set<string> }>();
    for (const entry of entries) {
      const current = grouped.get(entry.userId) ?? {
        username: entry.username,
        dates: new Set<string>(),
      };
      current.dates.add(entry.checkinDate);
      grouped.set(entry.userId, current);
    }

    const rows = Array.from(grouped.entries()).map(([userId, value]) => ({
      userId,
      username: value.username,
      streak: computeStreakFromDateSet(value.dates, chinaNow, dayCount),
    }));

    const result = {
      period,
      generatedAt: Date.now(),
      leaderboard: rows
        .sort((a, b) => {
          if (b.streak !== a.streak) return b.streak - a.streak;
          return a.userId - b.userId;
        })
        .slice(0, safeLimit)
        .map((row, index) => ({ rank: index + 1, ...row })),
    };

    await setNativeRankingCache(cacheKey, 'checkin', period, OTHER_RANKING_CACHE_TTL_SECONDS, result);
    return { ...result, leaderboard: await enrichEntriesWithProfile(result.leaderboard) };
  }

  const users = await getAllUsers();

  const validUsers = users
    .map((user) => ({ id: ensurePositiveInteger(user.id), username: user.username }))
    .filter((u) => u.id > 0);

  const allStreaks = await Promise.all(
    validUsers.map((u) => getCheckinStreak(u.id, period))
  );

  const rows: Array<Omit<CheckinStreakLeaderboardEntry, 'rank'>> = validUsers.map((user, i) => ({
    userId: user.id,
    username: user.username || `#${user.id}`,
    streak: allStreaks[i],
  }));

  const leaderboard = rows
    .sort((a, b) => {
      if (b.streak !== a.streak) return b.streak - a.streak;
      return a.userId - b.userId;
    })
    .slice(0, safeLimit)
    .map((row, index) => ({ rank: index + 1, ...row }));

  return {
    period,
    generatedAt: Date.now(),
    leaderboard: await enrichEntriesWithProfile(leaderboard),
  };
}
