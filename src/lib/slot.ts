import { randomBytes } from 'crypto';
import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import { addGamePointsWithLimit, applyPointsDelta, getUserPoints } from './points';
import { getSlotConfig } from './slot-config';
import { getTodayDateString } from './time';
import { getDailyPointsLimit } from './config';
import type { DailyGameStats } from './types/game';
import {
  SLOT_MAX_RECORD_ENTRIES,
  SLOT_SPIN_COOLDOWN_MS,
  SLOT_STATUS_RECORD_LIMIT,
  SLOT_SYMBOLS,
  SLOT_TWO_OF_KIND_PAYOUT,
  type SlotSymbolId,
} from './slot-constants';

export type SlotPlayMode = 'earn' | 'bet';

export interface SlotSpinRecord {
  id: string;
  userId: number;
  gameType: 'slot';
  mode?: SlotPlayMode;
  betCost?: number;
  reels: SlotSymbolId[];
  payout: number;
  pointsEarned: number;
  pointsDelta?: number;
  createdAt: number;
}

export interface SlotStatus {
  balance: number;
  dailyStats: {
    gamesPlayed: number;
    pointsEarned: number;
  } | null;
  inCooldown: boolean;
  cooldownRemaining: number; // ms
  dailyLimit: number;
  pointsLimitReached: boolean;
  config: {
    betModeEnabled: boolean;
    betCost: number;
  };
  records: SlotSpinRecord[];
}

const SLOT_LAST_SPIN_AT_KEY = (userId: number) => `slot:last_spin_at:${userId}`;
const SLOT_SPIN_LOCK_KEY = (userId: number) => `slot:spin_lock:${userId}`;
const SLOT_RECORDS_KEY = (userId: number) => `slot:records:${userId}`;

const DAILY_STATS_KEY = (userId: number, date: string) => `game:daily:${userId}:${date}`;
const DAILY_STATS_TTL = 48 * 60 * 60; // 48小时

const SLOT_RANK_DAILY_KEY = (date: string) => `slot:rank:daily:${date}`;

const SPIN_LOCK_TTL = 10; // 秒：防并发与重复请求

const SYMBOL_BY_ID: Record<SlotSymbolId, (typeof SLOT_SYMBOLS)[number]> = SLOT_SYMBOLS.reduce(
  (acc, symbol) => {
    acc[symbol.id] = symbol;
    return acc;
  },
  {} as Record<SlotSymbolId, (typeof SLOT_SYMBOLS)[number]>
);

const TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0);

function randomInt(maxExclusive: number): number {
  if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) {
    throw new Error('Invalid maxExclusive');
  }
  const n = randomBytes(4).readUInt32BE(0);
  return n % maxExclusive;
}

function pickSymbolId(): SlotSymbolId {
  if (TOTAL_WEIGHT <= 0) {
    throw new Error('Slot symbols total weight must be > 0');
  }
  let r = randomInt(TOTAL_WEIGHT);
  for (const symbol of SLOT_SYMBOLS) {
    r -= symbol.weight;
    if (r < 0) return symbol.id;
  }
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1]!.id;
}

function computePayout(reels: SlotSymbolId[]): {
  payout: number;
  match: 'none' | 'two' | 'three';
  matchedSymbolId?: SlotSymbolId;
} {
  const [a, b, c] = reels;

  if (a === b && b === c) {
    return { payout: SYMBOL_BY_ID[a].triplePayout, match: 'three', matchedSymbolId: a };
  }

  if (a === b || a === c || b === c) {
    const matched = a === b ? a : a === c ? a : b;
    return { payout: SLOT_TWO_OF_KIND_PAYOUT, match: 'two', matchedSymbolId: matched };
  }

  return { payout: 0, match: 'none' };
}

async function getSharedDailyStats(userId: number): Promise<DailyGameStats> {
  const date = getTodayDateString();
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

export async function getCooldownRemainingMs(userId: number): Promise<number> {
  const lastSpinAt = await kv.get<number>(SLOT_LAST_SPIN_AT_KEY(userId));
  if (!lastSpinAt) return 0;

  const remaining = lastSpinAt + SLOT_SPIN_COOLDOWN_MS - Date.now();
  return remaining > 0 ? remaining : 0;
}

export async function getSlotRecords(userId: number, limit: number = SLOT_STATUS_RECORD_LIMIT): Promise<SlotSpinRecord[]> {
  const safeLimit = Math.max(0, Math.min(limit, SLOT_MAX_RECORD_ENTRIES));
  if (safeLimit === 0) return [];
  const records = await kv.lrange<SlotSpinRecord>(SLOT_RECORDS_KEY(userId), 0, safeLimit - 1);
  return records ?? [];
}

export async function getSlotStatus(userId: number): Promise<SlotStatus> {
  const [balance, dailyStats, dailyLimit, slotConfig, records, cooldownRemaining] = await Promise.all([
    getUserPoints(userId),
    getSharedDailyStats(userId),
    getDailyPointsLimit(),
    getSlotConfig(),
    getSlotRecords(userId, SLOT_STATUS_RECORD_LIMIT),
    getCooldownRemainingMs(userId),
  ]);

  const pointsLimitReached = dailyStats.pointsEarned >= dailyLimit;

  return {
    balance,
    dailyStats: dailyStats
      ? { gamesPlayed: dailyStats.gamesPlayed, pointsEarned: dailyStats.pointsEarned }
      : null,
    inCooldown: cooldownRemaining > 0,
    cooldownRemaining,
    dailyLimit,
    pointsLimitReached,
    config: {
      betModeEnabled: !!slotConfig.betModeEnabled,
      betCost: Number.isFinite(slotConfig.betCost) ? slotConfig.betCost : 10,
    },
    records,
  };
}

export async function spinSlot(userId: number, mode: SlotPlayMode = 'earn'): Promise<
  | {
      success: true;
      data: {
        record: SlotSpinRecord;
        pointsEarned: number;
        pointsDelta: number;
        newBalance: number;
        dailyStats: { gamesPlayed: number; pointsEarned: number };
        dailyLimit: number;
        pointsLimitReached: boolean;
      };
    }
  | { success: false; message: string; cooldownRemaining?: number }
> {
  const lockKey = SLOT_SPIN_LOCK_KEY(userId);
  const lockAcquired = await kv.set(lockKey, '1', { ex: SPIN_LOCK_TTL, nx: true });
  if (!lockAcquired) {
    return { success: false, message: '操作太快啦，请稍候再试' };
  }

  try {
    const cooldownRemaining = await getCooldownRemainingMs(userId);
    if (cooldownRemaining > 0) {
      return {
        success: false,
        message: `冷却中，请等待 ${Math.ceil(cooldownRemaining / 1000)} 秒`,
        cooldownRemaining,
      };
    }

    // 先写入 lastSpinAt，避免并发/重试导致多次发放
    const now = Date.now();
    await kv.set(SLOT_LAST_SPIN_AT_KEY(userId), now, { ex: 60 });

    const reels: SlotSymbolId[] = [pickSymbolId(), pickSymbolId(), pickSymbolId()];
    const { payout, match, matchedSymbolId } = computePayout(reels);

    const dailyLimit = await getDailyPointsLimit();

    const date = getTodayDateString();
    const dailyStats = await getSharedDailyStats(userId);

    if (mode === 'bet') {
      const slotConfig = await getSlotConfig();
      if (!slotConfig.betModeEnabled) {
        return { success: false, message: '管理员未开启赌积分模式' };
      }

      const betCost = Number(slotConfig.betCost);
      if (!Number.isInteger(betCost) || betCost < 1) {
        return { success: false, message: '下注配置异常，请联系管理员' };
      }

      const pointsDelta = payout - betCost;
      const description =
        payout > 0
          ? `老虎机赌积分：下注${betCost}，${match === 'three' ? '三连' : '二连'}${
              matchedSymbolId ? ` ${SYMBOL_BY_ID[matchedSymbolId].name}` : ''
            } +${payout}，净 ${pointsDelta >= 0 ? `+${pointsDelta}` : String(pointsDelta)}`
          : `老虎机赌积分：下注${betCost}，未中奖，净 -${betCost}`;

      const deltaResult = await applyPointsDelta(userId, pointsDelta, 'game_play', description);
      if (!deltaResult.success) {
        return { success: false, message: deltaResult.message || '积分不足' };
      }

      const record: SlotSpinRecord = {
        id: nanoid(),
        userId,
        gameType: 'slot',
        mode: 'bet',
        betCost,
        reels,
        payout,
        pointsEarned: payout,
        pointsDelta,
        createdAt: now,
      };

      const newDailyStats: DailyGameStats = {
        userId,
        date,
        gamesPlayed: dailyStats.gamesPlayed + 1,
        totalScore: dailyStats.totalScore + payout,
        pointsEarned: dailyStats.pointsEarned,
        lastGameAt: now,
      };

      const tasks: Promise<unknown>[] = [
        kv.set(DAILY_STATS_KEY(userId, date), newDailyStats, { ex: DAILY_STATS_TTL }),
        kv.lpush(SLOT_RECORDS_KEY(userId), record),
      ];
      if (pointsDelta > 0) {
        tasks.push(kv.zincrby(SLOT_RANK_DAILY_KEY(date), pointsDelta, `u:${userId}`));
        tasks.push(kv.expire(SLOT_RANK_DAILY_KEY(date), DAILY_STATS_TTL));
      }
      await Promise.all(tasks);
      await kv.ltrim(SLOT_RECORDS_KEY(userId), 0, SLOT_MAX_RECORD_ENTRIES - 1);

      const pointsLimitReached = newDailyStats.pointsEarned >= dailyLimit;

      return {
        success: true,
        data: {
          record,
          pointsEarned: payout,
          pointsDelta,
          newBalance: deltaResult.balance,
          dailyStats: { gamesPlayed: newDailyStats.gamesPlayed, pointsEarned: newDailyStats.pointsEarned },
          dailyLimit,
          pointsLimitReached,
        },
      };
    }

    const pointsResult = await addGamePointsWithLimit(
      userId,
      payout,
      dailyLimit,
      'game_play',
      payout > 0
        ? `老虎机${match === 'three' ? '三连' : '二连'}：${matchedSymbolId ? SYMBOL_BY_ID[matchedSymbolId].name : ''} +${payout}`
        : '老虎机未中奖'
    );

    const record: SlotSpinRecord = {
      id: nanoid(),
      userId,
      gameType: 'slot',
      mode: 'earn',
      betCost: 0,
      reels,
      payout,
      pointsEarned: pointsResult.pointsEarned,
      pointsDelta: pointsResult.pointsEarned,
      createdAt: now,
    };

    const newDailyStats: DailyGameStats = {
      userId,
      date,
      gamesPlayed: dailyStats.gamesPlayed + 1,
      totalScore: dailyStats.totalScore + payout,
      pointsEarned: pointsResult.dailyEarned,
      lastGameAt: now,
    };

    const tasks: Promise<unknown>[] = [
      kv.set(DAILY_STATS_KEY(userId, date), newDailyStats, { ex: DAILY_STATS_TTL }),
      kv.lpush(SLOT_RECORDS_KEY(userId), record),
    ];
    const pointsDelta = pointsResult.pointsEarned;
    if (pointsDelta > 0) {
      tasks.push(kv.zincrby(SLOT_RANK_DAILY_KEY(date), pointsDelta, `u:${userId}`));
      tasks.push(kv.expire(SLOT_RANK_DAILY_KEY(date), DAILY_STATS_TTL));
    }
    await Promise.all(tasks);
    await kv.ltrim(SLOT_RECORDS_KEY(userId), 0, SLOT_MAX_RECORD_ENTRIES - 1);

    const pointsLimitReached = newDailyStats.pointsEarned >= dailyLimit;

    return {
      success: true,
      data: {
        record,
        pointsEarned: pointsResult.pointsEarned,
        pointsDelta: pointsResult.pointsEarned,
        newBalance: pointsResult.balance,
        dailyStats: { gamesPlayed: newDailyStats.gamesPlayed, pointsEarned: newDailyStats.pointsEarned },
        dailyLimit,
        pointsLimitReached,
      },
    };
  } finally {
    await kv.del(lockKey);
  }
}
