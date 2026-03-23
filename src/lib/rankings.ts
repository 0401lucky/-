import { kv } from '@/lib/d1-kv';
import { getAllUsers } from './kv';
import type { GameType } from './types/game';
import {
  getNativeCheckinEntries,
  getNativeGameLeaderboardRows,
  getNativeOverallBreakdownRows,
  getNativePointsLeaderboardRows,
  getNativeRankingCache,
  isNativeHotStoreReady,
  listNativeCheckinDates,
  setNativeRankingCache,
} from './hot-d1';

const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_RECORD_SCAN = 200;
const MAX_STREAK_DAYS = 400;
const ALL_GAMES_RANKING_CACHE_TTL_SECONDS = 30;
const OTHER_RANKING_CACHE_TTL_SECONDS = 30;

export type RankingPeriod = 'daily' | 'weekly' | 'monthly';
export type PointsRankingPeriod = 'all' | 'monthly';
export type CheckinRankingPeriod = 'all' | 'monthly';
export type SupportedRankingGame = Extract<GameType, 'slot' | 'linkgame' | 'match3' | 'memory' | 'pachinko' | 'tower'>;

interface BaseRecord {
  score?: number;
  pointsEarned?: number;
  createdAt?: number;
}

export interface GameLeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  gameType: SupportedRankingGame;
  totalScore: number;
  totalPoints: number;
  bestScore: number;
  gamesPlayed: number;
}

export interface GameRankingResult {
  gameType: SupportedRankingGame;
  leaderboard: GameLeaderboardEntry[];
}

export interface OverallLeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
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

export interface PointsLeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  points: number;
}

export interface CheckinStreakLeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  streak: number;
}

const GAME_RECORD_KEY: Record<SupportedRankingGame, (userId: number) => string> = {
  slot: (userId) => `slot:records:${userId}`,
  linkgame: (userId) => `linkgame:records:${userId}`,
  match3: (userId) => `match3:records:${userId}`,
  memory: (userId) => `memory:records:${userId}`,
  pachinko: (userId) => `game:records:${userId}`,
  tower: (userId) => `tower:records:${userId}`,
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

function getAllGamesLeaderboardCacheKey(
  period: RankingPeriod,
  options: { limitPerGame?: number; overallLimit?: number },
): string {
  const limitPerGame = Math.max(1, Math.min(100, Math.floor(options.limitPerGame ?? 20)));
  const overallLimit = Math.max(1, Math.min(100, Math.floor(options.overallLimit ?? 20)));
  return `rankings:all-games:${period}:${limitPerGame}:${overallLimit}`;
}

function getPointsRankingCacheKey(period: PointsRankingPeriod, limit: number): string {
  return `rankings:points:${period}:${Math.max(1, Math.min(100, Math.floor(limit)))}`;
}

function getCheckinRankingCacheKey(period: CheckinRankingPeriod, limit: number): string {
  return `rankings:checkin:${period}:${Math.max(1, Math.min(100, Math.floor(limit)))}`;
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

async function getRecordsInPeriod(
  userId: number,
  gameType: SupportedRankingGame,
  startAt: number,
  endAt: number = Number.POSITIVE_INFINITY,
): Promise<BaseRecord[]> {
  const key = GAME_RECORD_KEY[gameType](userId);
  const records = await kv.lrange<BaseRecord>(key, 0, MAX_RECORD_SCAN - 1);
  if (!Array.isArray(records)) return [];

  return records.filter((record) => {
    if (!record || typeof record !== 'object') return false;
    const createdAt = toFiniteNumber(record.createdAt);
    return createdAt >= startAt && createdAt < endAt;
  });
}

async function getGameLeaderboardByRange(
  gameType: SupportedRankingGame,
  startAt: number,
  endAt: number,
  limit = 20,
): Promise<GameLeaderboardEntry[]> {
  if (await isNativeHotStoreReady()) {
    const rows = await getNativeGameLeaderboardRows(gameType, startAt, endAt, limit);
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
    validUsers.map((u) => getRecordsInPeriod(u.id, gameType, startAt, endAt))
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

  return sortByScore(rows)
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
): Promise<GameLeaderboardEntry[]> {
  const startAt = getPeriodStartUtc(period);
  return getGameLeaderboardByRange(gameType, startAt, Number.POSITIVE_INFINITY, limit);
}

export async function getAllGamesLeaderboardByRange(
  startAt: number,
  endAt: number,
  options: { limitPerGame?: number; overallLimit?: number } = {}
): Promise<AllGamesRankingSnapshot> {
  const limitPerGame = Math.max(1, Math.min(100, Math.floor(options.limitPerGame ?? 20)));
  const overallLimit = Math.max(1, Math.min(100, Math.floor(options.overallLimit ?? 20)));

  const gameTypes: SupportedRankingGame[] = ['slot', 'linkgame', 'match3', 'memory', 'pachinko', 'tower'];

  const allLeaderboards = await Promise.all(
    gameTypes.map((gameType) => getGameLeaderboardByRange(gameType, startAt, endAt, limitPerGame))
  );

  const gameResults: GameRankingResult[] = gameTypes.map((gameType, i) => ({
    gameType,
    leaderboard: allLeaderboards[i],
  }));

  const overallMap = new Map<number, Omit<OverallLeaderboardEntry, 'rank'>>();

  if (await isNativeHotStoreReady()) {
    const nativeRows = await getNativeOverallBreakdownRows(startAt, endAt);
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
      return cached;
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
    return result;
  }

  const cached = await kv.get<AllGamesRankingResult>(cacheKey);
  if (cached && Array.isArray(cached.games) && Array.isArray(cached.overall)) {
    return cached;
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
  return result;
}

function getMonthlyStartUtc(): number {
  const chinaNow = getChinaDate();
  chinaNow.setUTCDate(1);
  chinaNow.setUTCHours(0, 0, 0, 0);
  return chinaNow.getTime() - CHINA_TZ_OFFSET_MS;
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
      return cached;
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
    return result;
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
      const logs = await kv.lrange<{ amount?: number; createdAt?: number }>(
        `points_log:${user.id}`,
        0,
        MAX_RECORD_SCAN - 1,
      );
      return (logs ?? []).reduce((sum, item) => {
        const createdAt = toFiniteNumber(item?.createdAt);
        if (createdAt < startAt) return sum;
        return sum + toFiniteNumber(item?.amount);
      }, 0);
    })
  );

  const rows: Array<Omit<PointsLeaderboardEntry, 'rank'>> = validUsers.map((user, i) => ({
    userId: user.id,
    username: user.username || `#${user.id}`,
    points: allPoints[i],
  }));

  const leaderboard = [...rows]
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.userId - b.userId;
    })
    .slice(0, safeLimit)
    .map((row, index) => ({ rank: index + 1, ...row }));

  return {
    period,
    generatedAt: Date.now(),
    leaderboard,
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
      return cached;
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
    return result;
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
    leaderboard,
  };
}
