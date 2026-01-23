// src/lib/points.ts

import { kv } from '@vercel/kv';
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

  // Lua 脚本：原子化计算并发放积分
  const luaScript = `
    local pointsKey = KEYS[1]
    local dailyEarnedKey = KEYS[2]
    local score = tonumber(ARGV[1])
    local dailyLimit = tonumber(ARGV[2])
    local ttl = tonumber(ARGV[3])
    
    -- 获取今日已得积分
    local dailyEarned = tonumber(redis.call('GET', dailyEarnedKey) or '0')
    
    -- 计算可发放积分
    local remaining = dailyLimit - dailyEarned
    if remaining < 0 then remaining = 0 end
    local grant = score
    if grant > remaining then grant = remaining end
    
    local newBalance = 0
    local newDailyEarned = dailyEarned
    
    if grant > 0 then
      -- 增加用户余额
      newBalance = redis.call('INCRBY', pointsKey, grant)
      -- 增加今日已得
      newDailyEarned = redis.call('INCRBY', dailyEarnedKey, grant)
      -- 设置 TTL（如果是新 key）
      redis.call('EXPIRE', dailyEarnedKey, ttl)
    else
      newBalance = tonumber(redis.call('GET', pointsKey) or '0')
    end
    
    local limitReached = 0
    if newDailyEarned >= dailyLimit then limitReached = 1 end
    
    return {grant, newBalance, newDailyEarned, limitReached}
  `;

  const result = await kv.eval(
    luaScript, 
    [pointsKey, dailyEarnedKey], 
    [score, dailyLimit, DAILY_EARNED_TTL]
  ) as [number, number, number, number];
  
  const [pointsEarned, balance, dailyEarned, limitReachedFlag] = result;

  // 如果实际发放了积分，记录流水
  if (pointsEarned > 0) {
    const log: PointsLog = {
      id: nanoid(),
      amount: pointsEarned,
      source,
      description,
      balance,
      createdAt: Date.now(),
    };

    await kv.lpush(POINTS_LOG_KEY(userId), log);
    await kv.ltrim(POINTS_LOG_KEY(userId), 0, MAX_LOG_ENTRIES - 1);
  }

  return {
    success: true,
    pointsEarned,
    balance,
    dailyEarned,
    limitReached: limitReachedFlag === 1,
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

  // 使用 Lua 脚本保证原子性：检查余额并扣除
  const luaScript = `
    local current = tonumber(redis.call('GET', KEYS[1]) or '0')
    local amount = tonumber(ARGV[1])
    if current < amount then
      return {0, current}
    end
    local newBalance = redis.call('DECRBY', KEYS[1], amount)
    return {1, newBalance}
  `;

  const result = await kv.eval(luaScript, [pointsKey], [amount]) as [number, number];
  const [success, balance] = result;

  if (success === 0) {
    return {
      success: false,
      balance,
      message: '积分不足',
    };
  }

  // 记录流水（扣除用负数）
  const log: PointsLog = {
    id: nanoid(),
    amount: -amount,
    source,
    description,
    balance,
    createdAt: Date.now(),
  };

  await kv.lpush(POINTS_LOG_KEY(userId), log);
  await kv.ltrim(POINTS_LOG_KEY(userId), 0, MAX_LOG_ENTRIES - 1);

  return { success: true, balance };
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

  const luaScript = `
    local pointsKey = KEYS[1]
    local logKey = KEYS[2]
    local delta = tonumber(ARGV[1])
    local logId = ARGV[2]
    local source = ARGV[3]
    local description = ARGV[4]
    local now = tonumber(ARGV[5])
    local maxLogs = tonumber(ARGV[6])

    local current = tonumber(redis.call('GET', pointsKey) or '0')
    if delta < 0 and current < (-delta) then
      return {0, current}
    end

    local newBalance = redis.call('INCRBY', pointsKey, delta)

    local log = {id = logId, amount = delta, source = source, description = description, balance = newBalance, createdAt = now}
    redis.call('LPUSH', logKey, cjson.encode(log))
    redis.call('LTRIM', logKey, 0, maxLogs - 1)

    return {1, newBalance}
  `;

  const result = await kv.eval(
    luaScript,
    [pointsKey, logKey],
    [delta, logId, source, description.trim(), now, MAX_LOG_ENTRIES]
  ) as [number, number];

  const [ok, balance] = result;
  if (ok === 0) {
    return { success: false, balance, message: '积分不足' };
  }

  return { success: true, balance };
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
