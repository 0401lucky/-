import { kv } from '@/lib/d1-kv';
import { getTodayDateString } from './time';
import type { DailyGameStats } from './types/game';
import {
  getNativeDailyStats,
  incrementNativeDailyStats,
  isNativeHotStoreReady,
} from './hot-d1';

const DAILY_STATS_TTL_SECONDS = 48 * 60 * 60;
const DAILY_STATS_KEY = (userId: number, date: string) => `game:daily:${userId}:${date}`;

function normalizeStats(raw: Record<string, unknown>, fallback: DailyGameStats): DailyGameStats {
  return {
    userId: typeof raw.userId === 'number' ? raw.userId : fallback.userId,
    date: typeof raw.date === 'string' ? raw.date : fallback.date,
    gamesPlayed: typeof raw.gamesPlayed === 'number' ? raw.gamesPlayed : fallback.gamesPlayed,
    totalScore: typeof raw.totalScore === 'number' ? raw.totalScore : fallback.totalScore,
    pointsEarned: typeof raw.pointsEarned === 'number' ? raw.pointsEarned : fallback.pointsEarned,
    lastGameAt: typeof raw.lastGameAt === 'number' ? raw.lastGameAt : fallback.lastGameAt,
  };
}

export async function getDailyStats(userId: number): Promise<DailyGameStats> {
  const date = getTodayDateString();
  if (await isNativeHotStoreReady()) {
    return getNativeDailyStats(userId, date);
  }

  const stats = await kv.get<DailyGameStats>(DAILY_STATS_KEY(userId, date));

  if (stats) return stats;

  return {
    userId,
    date,
    gamesPlayed: 0,
    totalScore: 0,
    pointsEarned: 0,
    lastGameAt: 0,
  };
}

export async function incrementSharedDailyStats(
  userId: number,
  scoreDelta: number,
  cumulativePointsEarned: number,
  now: number = Date.now(),
): Promise<DailyGameStats> {
  const date = getTodayDateString();
  const key = DAILY_STATS_KEY(userId, date);

  if (await isNativeHotStoreReady()) {
    return incrementNativeDailyStats(userId, date, scoreDelta, cumulativePointsEarned, now);
  }

  const fallback: DailyGameStats = {
    userId,
    date,
    gamesPlayed: 1,
    totalScore: scoreDelta,
    pointsEarned: cumulativePointsEarned,
    lastGameAt: now,
  };

  try {
    const current = await kv.get<DailyGameStats>(key);
    const stats: DailyGameStats = current
      ? normalizeStats(current as unknown as Record<string, unknown>, fallback)
      : { userId, date, gamesPlayed: 0, totalScore: 0, pointsEarned: 0, lastGameAt: now };

    stats.userId = userId;
    stats.date = date;
    stats.gamesPlayed += 1;
    stats.totalScore += scoreDelta;
    if (cumulativePointsEarned > stats.pointsEarned) {
      stats.pointsEarned = cumulativePointsEarned;
    }
    stats.lastGameAt = now;

    await kv.set(key, stats, { ex: DAILY_STATS_TTL_SECONDS });
    return stats;
  } catch {
    return fallback;
  }
}
