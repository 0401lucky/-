import { kv } from '@vercel/kv';
import { getAllUsers } from './kv';
import type { GameType } from './types/game';

const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_RECORD_SCAN = 200;
const MAX_STREAK_DAYS = 400;

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
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const users = await getAllUsers();

  const rows: Omit<GameLeaderboardEntry, 'rank'>[] = [];

  for (const user of users) {
    const userId = ensurePositiveInteger(user.id);
    if (userId <= 0) continue;

    const records = await getRecordsInPeriod(userId, gameType, startAt, endAt);
    if (records.length === 0) continue;

    const totalScore = records.reduce((sum, record) => sum + toFiniteNumber(record.score), 0);
    const totalPoints = records.reduce((sum, record) => sum + toFiniteNumber(record.pointsEarned), 0);
    const bestScore = records.reduce((max, record) => Math.max(max, toFiniteNumber(record.score)), 0);

    rows.push({
      userId,
      username: user.username || `#${userId}`,
      gameType,
      totalScore,
      totalPoints,
      bestScore,
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
  const gameResults: GameRankingResult[] = [];

  const overallMap = new Map<number, Omit<OverallLeaderboardEntry, 'rank'>>();

  for (const gameType of gameTypes) {
    const leaderboard = await getGameLeaderboardByRange(gameType, startAt, endAt, limitPerGame);
    gameResults.push({ gameType, leaderboard });

    for (const entry of leaderboard) {
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
  const snapshot = await getAllGamesLeaderboardByRange(
    startAt,
    Number.POSITIVE_INFINITY,
    options,
  );

  return {
    period,
    generatedAt: snapshot.generatedAt,
    startAt,
    games: snapshot.games,
    overall: snapshot.overall,
  };
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
  const users = await getAllUsers();

  const startAt = period === 'monthly' ? getMonthlyStartUtc() : 0;

  const rows: Array<Omit<PointsLeaderboardEntry, 'rank'>> = [];

  for (const user of users) {
    const userId = ensurePositiveInteger(user.id);
    if (userId <= 0) continue;

    let points = 0;

    if (period === 'all') {
      points = toFiniteNumber(await kv.get<number>(`points:${userId}`));
    } else {
      const logs = await kv.lrange<{ amount?: number; createdAt?: number }>(
        `points_log:${userId}`,
        0,
        MAX_RECORD_SCAN - 1,
      );

      points = (logs ?? []).reduce((sum, item) => {
        const createdAt = toFiniteNumber(item?.createdAt);
        if (createdAt < startAt) return sum;
        return sum + toFiniteNumber(item?.amount);
      }, 0);
    }

    rows.push({
      userId,
      username: user.username || `#${userId}`,
      points,
    });
  }

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

export async function getCheckinStreakLeaderboard(
  period: CheckinRankingPeriod = 'all',
  limit = 20,
): Promise<{ period: CheckinRankingPeriod; generatedAt: number; leaderboard: CheckinStreakLeaderboardEntry[] }> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const users = await getAllUsers();

  const rows: Array<Omit<CheckinStreakLeaderboardEntry, 'rank'>> = [];

  for (const user of users) {
    const userId = ensurePositiveInteger(user.id);
    if (userId <= 0) continue;

    const streak = await getCheckinStreak(userId, period);
    rows.push({
      userId,
      username: user.username || `#${userId}`,
      streak,
    });
  }

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
