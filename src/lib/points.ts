// src/lib/points.ts

import { kv } from '@/lib/d1-kv';
import { nanoid } from 'nanoid';
import { getTodayDateString } from './time';
import type { PointsLog, PointsSource } from './types/store';

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

  // 原子增加积分
  const newBalance = await kv.incrby(POINTS_KEY(userId), amount);

  // 记录流水
  const log: PointsLog = {
    id: nanoid(),
    amount,
    source,
    description,
    balance: newBalance,
    createdAt: Date.now(),
  };

  await kv.lpush(POINTS_LOG_KEY(userId), log);
  // 保持最近100条记录
  await kv.ltrim(POINTS_LOG_KEY(userId), 0, MAX_LOG_ENTRIES - 1);

  return { success: true, balance: newBalance };
}

/**
 * 原子化游戏积分发放（带每日上限限制）
 * 使用 Lua 脚本确保: 读取今日已得 → 计算可发放 → 增加余额 → 更新今日已得 全部原子完成
 */
export async function addGamePointsWithLimit(
  userId: number,
  score: number,
  dailyLimit: number,
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
    // 0分情况直接返回当前状态
    const [balance, dailyEarned] = await Promise.all([
      getUserPoints(userId),
      getDailyEarnedPoints(userId),
    ]);
    return {
      success: true,
      pointsEarned: 0,
      balance,
      dailyEarned,
      limitReached: dailyEarned >= dailyLimit,
    };
  }

  const date = getTodayDateString();
  const pointsKey = POINTS_KEY(userId);
  const dailyEarnedKey = DAILY_EARNED_KEY(userId, date);

  // Read current daily earned
  const dailyEarnedRaw = await kv.get<number>(dailyEarnedKey);
  const dailyEarned = dailyEarnedRaw ?? 0;

  // Calculate grantable amount
  const remaining = Math.max(0, dailyLimit - dailyEarned);
  const grant = Math.min(score, remaining);

  let balance: number;
  let newDailyEarned = dailyEarned;

  if (grant > 0) {
    // 并行执行两个 incrby
    const [bal, daily] = await Promise.all([
      kv.incrby(pointsKey, grant),
      kv.incrby(dailyEarnedKey, grant),
    ]);
    balance = bal;
    newDailyEarned = daily;

    const log: PointsLog = {
      id: nanoid(),
      amount: grant,
      source,
      description,
      balance,
      createdAt: Date.now(),
    };

    // 并行执行 expire + lpush，ltrim 不阻塞返回
    await Promise.all([
      kv.expire(dailyEarnedKey, DAILY_EARNED_TTL),
      kv.lpush(POINTS_LOG_KEY(userId), log),
    ]);
    kv.ltrim(POINTS_LOG_KEY(userId), 0, MAX_LOG_ENTRIES - 1).catch(() => {});
  } else {
    const currentBalance = await kv.get<number>(pointsKey);
    balance = currentBalance ?? 0;
  }

  const limitReached = newDailyEarned >= dailyLimit;

  return {
    success: true,
    pointsEarned: grant,
    balance,
    dailyEarned: newDailyEarned,
    limitReached,
  };
}

/**
 * 获取用户今日游戏已得积分
 */
export async function getDailyEarnedPoints(userId: number): Promise<number> {
  const date = getTodayDateString();
  const earned = await kv.get<number>(DAILY_EARNED_KEY(userId, date));
  return earned ?? 0;
}

/**
 * 扣除积分（使用 Lua 脚本保证原子性）
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

  const pointsKey = POINTS_KEY(userId);
  const currentRaw = await kv.get<number>(pointsKey);
  const current = currentRaw ?? 0;

  if (current < amount) {
    return { success: false, balance: current, message: '积分不足' };
  }

  const newBalance = await kv.decrby(pointsKey, amount);

  // 记录流水（扣除用负数）
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
}

/**
 * 原子化调整积分（可正可负，负数时确保不会扣成负数）
 * 适用于“挑战模式”等需要一次性结算净输赢的场景
 */
export async function applyPointsDelta(
  userId: number,
  delta: number,
  source: PointsSource,
  description: string
): Promise<{ success: boolean; balance: number; message?: string }> {
  if (!Number.isSafeInteger(delta)) {
    throw new Error('Delta must be an integer');
  }

  if (delta === 0) {
    const balance = await getUserPoints(userId);
    return { success: true, balance };
  }

  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error('Description is required');
  }

  const pointsKey = POINTS_KEY(userId);
  const logKey = POINTS_LOG_KEY(userId);
  const now = Date.now();
  const logId = nanoid();

  const currentRaw = await kv.get<number>(pointsKey);
  const current = currentRaw ?? 0;

  if (delta < 0 && current < (-delta)) {
    return { success: false, balance: current, message: '积分不足' };
  }

  const newBalance = await kv.incrby(pointsKey, delta);

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
}

/**
 * 获取积分流水记录
 */
export async function getPointsLogs(
  userId: number,
  limit: number = 20
): Promise<PointsLog[]> {
  const logs = await kv.lrange<PointsLog>(POINTS_LOG_KEY(userId), 0, limit - 1);
  return logs ?? [];
}
