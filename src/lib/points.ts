// src/lib/points.ts

import { kv } from '@/lib/d1-kv';
import { nanoid } from 'nanoid';
import { getTodayDateString } from './time';
import type { PointsLog, PointsSource } from './types/store';
import { withUserEconomyLock } from './economy-lock';
import {
  addNativeGamePointsWithLimit,
  applyNativePointsDelta,
  getNativeDailyGamePoints,
  getNativePointsLogs,
  getNativeUserPoints,
  isNativeHotStoreReady,
  trimNativePointLogs,
} from './hot-d1';

// Key 格式
const POINTS_KEY = (userId: number) => `points:${userId}`;
const POINTS_LOG_KEY = (userId: number) => `points_log:${userId}`;
const DAILY_EARNED_KEY = (userId: number, date: string) => `game:daily_earned:${userId}:${date}`;

// 常量
const MAX_LOG_ENTRIES = 100;
const DAILY_EARNED_TTL = 48 * 60 * 60; // 48小时

/**
 * 获取用户积分余额
 */
export async function getUserPoints(userId: number): Promise<number> {
  if (await isNativeHotStoreReady()) {
    return getNativeUserPoints(userId);
  }

  const points = await kv.get<number>(POINTS_KEY(userId));
  return points ?? 0;
}

/**
 * 增加积分（原子操作）
 */
export async function addPoints(
  userId: number,
  amount: number,
  source: PointsSource,
  description: string
): Promise<{ success: true; balance: number }> {
  if (amount <= 0) {
    throw new Error('Amount must be positive');
  }

  return withUserEconomyLock(userId, async () => {
    if (await isNativeHotStoreReady()) {
      const logId = nanoid();
      const result = await applyNativePointsDelta(
        userId,
        amount,
        source,
        description,
        logId,
      );
      await trimNativePointLogs(userId, MAX_LOG_ENTRIES);
      return { success: true, balance: result.balance };
    }

    const newBalance = await kv.incrby(POINTS_KEY(userId), amount);

    const log: PointsLog = {
      id: nanoid(),
      amount,
      source,
      description,
      balance: newBalance,
      createdAt: Date.now(),
    };

    await kv.lpush(POINTS_LOG_KEY(userId), log);
    await kv.ltrim(POINTS_LOG_KEY(userId), 0, MAX_LOG_ENTRIES - 1);

    return { success: true, balance: newBalance };
  });
}

/**
 * 游戏积分发放（v2：取消每日上限，全额发放）
 * 用户决策：所有游戏一同取消"游戏积分"概念，统一计入福利积分。
 * dailyLimit 形参保留以兼容现有调用点，但不再生效；dailyEarned 仍累计供统计展示。
 */
export async function addGamePointsWithLimit(
  userId: number,
  score: number,
  _dailyLimit: number,
  source: PointsSource,
  description: string
): Promise<{
  success: boolean;
  pointsEarned: number;
  balance: number;
  dailyEarned: number;
  limitReached: boolean;
}> {
  if (score < 0) {
    throw new Error('Score must be non-negative');
  }

  if (score === 0) {
    const [balance, dailyEarned] = await Promise.all([
      getUserPoints(userId),
      getDailyEarnedPoints(userId),
    ]);
    return {
      success: true,
      pointsEarned: 0,
      balance,
      dailyEarned,
      limitReached: false,
    };
  }

  const date = getTodayDateString();
  const pointsKey = POINTS_KEY(userId);
  const dailyEarnedKey = DAILY_EARNED_KEY(userId, date);

  return withUserEconomyLock(userId, async () => {
    if (await isNativeHotStoreReady()) {
      const result = await addNativeGamePointsWithLimit(
        userId,
        score,
        Number.MAX_SAFE_INTEGER,
        source,
        description,
        nanoid(),
      );
      if (result.pointsEarned > 0) {
        await trimNativePointLogs(userId, MAX_LOG_ENTRIES);
      }
      return { ...result, limitReached: false };
    }

    const grant = score;
    const [nextBalance, nextDailyEarned] = await Promise.all([
      kv.incrby(pointsKey, grant),
      kv.incrby(dailyEarnedKey, grant),
    ]);

    const log: PointsLog = {
      id: nanoid(),
      amount: grant,
      source,
      description,
      balance: nextBalance,
      createdAt: Date.now(),
    };

    await Promise.all([
      kv.expire(dailyEarnedKey, DAILY_EARNED_TTL),
      kv.lpush(POINTS_LOG_KEY(userId), log),
    ]);
    kv.ltrim(POINTS_LOG_KEY(userId), 0, MAX_LOG_ENTRIES - 1).catch(() => {});

    return {
      success: true,
      pointsEarned: grant,
      balance: nextBalance,
      dailyEarned: nextDailyEarned,
      limitReached: false,
    };
  });
}

/**
 * 获取用户今日游戏已得积分
 */
export async function getDailyEarnedPoints(userId: number): Promise<number> {
  const date = getTodayDateString();
  if (await isNativeHotStoreReady()) {
    return getNativeDailyGamePoints(userId, date);
  }
  const earned = await kv.get<number>(DAILY_EARNED_KEY(userId, date));
  return earned ?? 0;
}

/**
 * 扣除积分（使用用户级串行锁避免并发穿透）
 */
export async function deductPoints(
  userId: number,
  amount: number,
  source: PointsSource,
  description: string
): Promise<{ success: boolean; balance: number; message?: string }> {
  if (amount <= 0) {
    throw new Error('Amount must be positive');
  }

  return withUserEconomyLock(userId, async () => {
    if (await isNativeHotStoreReady()) {
      const result = await applyNativePointsDelta(
        userId,
        -amount,
        source,
        description,
        nanoid(),
      );
      if (!result.success) {
        return result;
      }
      await trimNativePointLogs(userId, MAX_LOG_ENTRIES);
      return { success: true, balance: result.balance };
    }

    const pointsKey = POINTS_KEY(userId);
    const currentRaw = await kv.get<number>(pointsKey);
    const current = currentRaw ?? 0;

    if (current < amount) {
      return { success: false, balance: current, message: '积分不足' };
    }

    const newBalance = await kv.decrby(pointsKey, amount);

    const log: PointsLog = {
      id: nanoid(),
      amount: -amount,
      source,
      description,
      balance: newBalance,
      createdAt: Date.now(),
    };

    await kv.lpush(POINTS_LOG_KEY(userId), log);
    await kv.ltrim(POINTS_LOG_KEY(userId), 0, MAX_LOG_ENTRIES - 1);

    return { success: true, balance: newBalance };
  });
}

/**
 * 原子化调整积分（可正可负，负数时确保不会扣成负数）
 * 适用于“挑战模式”等需要一次性结算净输赢的场景
 */
export async function applyPointsDelta(
  userId: number,
  delta: number,
  source: PointsSource,
  description: string,
  options: { recordZero?: boolean } = {},
): Promise<{ success: boolean; balance: number; message?: string }> {
  if (!Number.isSafeInteger(delta)) {
    throw new Error('Delta must be an integer');
  }

  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error('Description is required');
  }

  const now = Date.now();
  const logId = nanoid();

  if (delta === 0 && !options.recordZero) {
    const balance = await getUserPoints(userId);
    return { success: true, balance };
  }

  return withUserEconomyLock(userId, async () => {
    if (await isNativeHotStoreReady()) {
      const result = await applyNativePointsDelta(
        userId,
        delta,
        source,
        description.trim(),
        logId,
        now,
      );
      if (!result.success) {
        return result;
      }
      await trimNativePointLogs(userId, MAX_LOG_ENTRIES);
      return { success: true, balance: result.balance };
    }

    const pointsKey = POINTS_KEY(userId);
    const logKey = POINTS_LOG_KEY(userId);
    const currentRaw = await kv.get<number>(pointsKey);
    const current = currentRaw ?? 0;

    if (delta < 0 && current < (-delta)) {
      return { success: false, balance: current, message: '积分不足' };
    }

    const newBalance = delta === 0 ? current : await kv.incrby(pointsKey, delta);

    const log: PointsLog = {
      id: logId,
      amount: delta,
      source,
      description: description.trim(),
      balance: newBalance,
      createdAt: now,
    };
    await kv.lpush(logKey, log);
    await kv.ltrim(logKey, 0, MAX_LOG_ENTRIES - 1);

    return { success: true, balance: newBalance };
  });
}

/**
 * 获取积分流水记录
 */
export async function getPointsLogs(
  userId: number,
  limit: number = 20
): Promise<PointsLog[]> {
  if (await isNativeHotStoreReady()) {
    return getNativePointsLogs(userId, limit);
  }

  const logs = await kv.lrange<PointsLog>(POINTS_LOG_KEY(userId), 0, limit - 1);
  return logs ?? [];
}
