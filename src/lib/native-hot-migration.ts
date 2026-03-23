import { kv } from "@/lib/d1-kv";
import { normalizeUserCards, type UserCards } from "./cards/draw";
import type { DailyGameStats, GameType } from "./types/game";
import type { PointsLog } from "./types/store";
import {
  getLegacyHotMigrationSource,
  hasNativeHotStoreBinding,
  replaceNativeDailyGamePoints,
  replaceNativeDailyStats,
  replaceNativeGameRecords,
  replaceNativePointLogs,
  replaceNativeUserCheckins,
  resetNativeHotStoreData,
  setNativeExtraSpinCount,
  setNativeHotStoreReady,
  setNativeUserCards,
  setNativeUserPoints,
  upsertNativeSlotDailyScores,
  updateNativeSystemConfig,
  upsertNativeUser,
} from "./hot-d1";

const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const CHECKIN_SCAN_DAYS = 400;
const RECENT_STATE_DAYS = 2;
const MAX_POINT_LOGS = 100;
const MAX_GAME_RECORDS = 200;

const GAME_RECORD_KEYS: Record<Exclude<GameType, "farm">, (userId: number) => string> = {
  pachinko: (userId) => `game:records:${userId}`,
  memory: (userId) => `memory:records:${userId}`,
  slot: (userId) => `slot:records:${userId}`,
  match3: (userId) => `match3:records:${userId}`,
  linkgame: (userId) => `linkgame:records:${userId}`,
  tower: (userId) => `tower:records:${userId}`,
};

export interface NativeHotMigrationOptions {
  dryRun?: boolean;
  offset?: number;
  limit?: number;
  reset?: boolean;
  finalize?: boolean;
}

export interface NativeHotMigrationResult {
  dryRun: boolean;
  users: number;
  migratedUsers: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  hasMore: boolean;
  resetApplied: boolean;
  finalized: boolean;
  pointsLogs: number;
  checkins: number;
  gameRecords: number;
  dailyPointsRows: number;
  dailyStatsRows: number;
  slotRankingUsers: number;
}

function getChinaDateString(offsetDays: number): string {
  const now = new Date(Date.now() + CHINA_TZ_OFFSET_MS);
  now.setUTCDate(now.getUTCDate() - offsetDays);
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getChinaDateStringFromTimestamp(timestamp: number): string {
  const d = new Date(timestamp + CHINA_TZ_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getLegacyCheckins(userId: number): Promise<Array<{ date: string; createdAt: number }>> {
  const dates = Array.from({ length: CHECKIN_SCAN_DAYS }, (_, index) => getChinaDateString(index));
  const values = await kv.mget<unknown>(...dates.map((date) => `user:checkin:${userId}:${date}`));

  return dates
    .map((date, index) => ({ date, value: values?.[index] }))
    .filter((entry) => entry.value !== null && entry.value !== undefined)
    .map((entry) => ({ date: entry.date, createdAt: Date.now() }));
}

async function getLegacyDailyGamePoints(userId: number): Promise<Array<{ date: string; earnedPoints: number }>> {
  const dates = Array.from({ length: RECENT_STATE_DAYS }, (_, index) => getChinaDateString(index));
  const values = await kv.mget<number>(...dates.map((date) => `game:daily_earned:${userId}:${date}`));

  return dates
    .map((date, index) => ({
      date,
      earnedPoints: Number(values?.[index] ?? 0),
    }))
    .filter((entry) => Number.isFinite(entry.earnedPoints) && entry.earnedPoints > 0);
}

async function getLegacyDailyStats(userId: number): Promise<DailyGameStats[]> {
  const dates = Array.from({ length: RECENT_STATE_DAYS }, (_, index) => getChinaDateString(index));
  const values = await kv.mget<DailyGameStats>(...dates.map((date) => `game:daily:${userId}:${date}`));

  return (values ?? []).filter((entry): entry is DailyGameStats => entry !== null);
}

async function getLegacyPointLogs(userId: number): Promise<PointsLog[]> {
  return (await kv.lrange<PointsLog>(`points_log:${userId}`, 0, MAX_POINT_LOGS - 1)) ?? [];
}

async function getLegacyGameRecords<T>(key: string): Promise<T[]> {
  return (await kv.lrange<T>(key, 0, MAX_GAME_RECORDS - 1)) ?? [];
}

export async function migrateNativeHotData(
  options: NativeHotMigrationOptions = {},
): Promise<NativeHotMigrationResult> {
  if (!hasNativeHotStoreBinding()) {
    throw new Error("当前环境没有 D1 绑定，无法迁移原生热路径数据");
  }

  const dryRun = options.dryRun === true;
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const source = await getLegacyHotMigrationSource();
  const allUsers = source.users;
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 10)));
  const users = allUsers.slice(offset, offset + limit);
  const nextOffset = offset + users.length < allUsers.length ? offset + users.length : null;
  const hasMore = nextOffset !== null;
  const todayDate = getChinaDateString(0);
  const slotTodayMap = new Map<number, number>();
  let pointsLogs = 0;
  let checkins = 0;
  let gameRecords = 0;
  let dailyPointsRows = 0;
  let dailyStatsRows = 0;

  if (!dryRun && options.reset === true) {
    await resetNativeHotStoreData();
    const legacyConfig = await kv.get<Record<string, unknown>>("system:config");
    if (legacyConfig) {
      await updateNativeSystemConfig(legacyConfig);
    }
  }

  for (const user of users) {
    const userId = Number(user.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      continue;
    }

    const [extraSpins, cardDataRaw, pointBalance, logs, userCheckins, recentDailyPoints, recentDailyStats] = await Promise.all([
      kv.get<number>(`user:extra_spins:${userId}`),
      kv.get<Partial<UserCards>>(`cards:user:${userId}`),
      kv.get<number>(`points:${userId}`),
      getLegacyPointLogs(userId),
      getLegacyCheckins(userId),
      getLegacyDailyGamePoints(userId),
      getLegacyDailyStats(userId),
    ]);

    const normalizedCards = normalizeUserCards(cardDataRaw);
    pointsLogs += logs.length;
    checkins += userCheckins.length;
    dailyPointsRows += recentDailyPoints.length;
    dailyStatsRows += recentDailyStats.length;

    const migratedRecords = new Map<GameType, unknown[]>();
    for (const [gameType, keyFactory] of Object.entries(GAME_RECORD_KEYS) as Array<[Exclude<GameType, "farm">, (userId: number) => string]>) {
      const records = await getLegacyGameRecords<Record<string, unknown>>(keyFactory(userId));
      migratedRecords.set(gameType, records);
      gameRecords += records.length;

      if (gameType === "slot") {
        for (const record of records) {
          const createdAt = Number(record.createdAt ?? 0);
          if (!Number.isFinite(createdAt) || getChinaDateStringFromTimestamp(createdAt) !== todayDate) {
            continue;
          }
          const rawPoints = Number(record.pointsDelta ?? record.pointsEarned ?? 0);
          if (!Number.isFinite(rawPoints) || rawPoints <= 0) {
            continue;
          }
          slotTodayMap.set(userId, (slotTodayMap.get(userId) ?? 0) + Math.floor(rawPoints));
        }
      }
    }

    if (dryRun) {
      continue;
    }

    await upsertNativeUser(userId, user.username, user.firstSeen);
    await setNativeExtraSpinCount(userId, extraSpins ?? 0);
    await setNativeUserCards(userId, normalizedCards);
    await setNativeUserPoints(userId, pointBalance ?? 0);
    await replaceNativePointLogs(userId, logs);
    await replaceNativeUserCheckins(userId, userCheckins);
    await replaceNativeDailyGamePoints(userId, recentDailyPoints);
    await replaceNativeDailyStats(userId, recentDailyStats);

    for (const [gameType, records] of migratedRecords.entries()) {
      await replaceNativeGameRecords(userId, gameType, records as Array<{
        id: string;
        userId: number;
        gameType: GameType;
        score?: number;
        pointsEarned?: number;
        createdAt?: number;
      }>);
    }
  }

  if (!dryRun) {
    await upsertNativeSlotDailyScores(
      todayDate,
      Array.from(slotTodayMap.entries()).map(([userId, score]) => ({ userId, score })),
    );
    if (options.finalize === true) {
      await setNativeHotStoreReady(true);
    }
  }

  return {
    dryRun,
    users: allUsers.length,
    migratedUsers: users.length,
    offset,
    limit,
    nextOffset,
    hasMore,
    resetApplied: !dryRun && options.reset === true,
    finalized: !dryRun && options.finalize === true,
    pointsLogs,
    checkins,
    gameRecords,
    dailyPointsRows,
    dailyStatsRows,
    slotRankingUsers: slotTodayMap.size,
  };
}
