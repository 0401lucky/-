import { kv } from '@vercel/kv';
import { getTodayDateString } from './time';
import type { DailyGameStats } from './types/game';

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

export async function incrementSharedDailyStats(
  userId: number,
  scoreDelta: number,
  cumulativePointsEarned: number,
  now: number = Date.now(),
): Promise<DailyGameStats> {
  const date = getTodayDateString();
  const key = DAILY_STATS_KEY(userId, date);

  const luaScript = `
    local key = KEYS[1]
    local userId = tonumber(ARGV[1])
    local date = ARGV[2]
    local scoreDelta = tonumber(ARGV[3])
    local pointsEarned = tonumber(ARGV[4])
    local now = tonumber(ARGV[5])
    local ttl = tonumber(ARGV[6])

    local current = redis.call('GET', key)
    local stats
    if current then
      stats = cjson.decode(current)
    else
      stats = {
        userId = userId,
        date = date,
        gamesPlayed = 0,
        totalScore = 0,
        pointsEarned = 0,
        lastGameAt = now,
      }
    end

    stats.userId = userId
    stats.date = date
    stats.gamesPlayed = tonumber(stats.gamesPlayed or 0) + 1
    stats.totalScore = tonumber(stats.totalScore or 0) + scoreDelta

    local previousPoints = tonumber(stats.pointsEarned or 0)
    if pointsEarned > previousPoints then
      stats.pointsEarned = pointsEarned
    else
      stats.pointsEarned = previousPoints
    end

    stats.lastGameAt = now

    redis.call('SET', key, cjson.encode(stats), 'EX', ttl)
    return cjson.encode(stats)
  `;

  const encoded = await kv.eval(
    luaScript,
    [key],
    [userId, date, scoreDelta, cumulativePointsEarned, now, DAILY_STATS_TTL_SECONDS],
  );

  const fallback: DailyGameStats = {
    userId,
    date,
    gamesPlayed: 1,
    totalScore: scoreDelta,
    pointsEarned: cumulativePointsEarned,
    lastGameAt: now,
  };

  if (typeof encoded !== 'string') {
    return fallback;
  }

  try {
    const parsed = JSON.parse(encoded) as Record<string, unknown>;
    return normalizeStats(parsed, fallback);
  } catch {
    return fallback;
  }
}
