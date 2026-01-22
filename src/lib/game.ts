// src/lib/game.ts

import { randomBytes } from 'crypto';
import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import { addGamePointsWithLimit } from './points';
import { getTodayDateString } from './time';
import type {
  GameSession,
  GameRecord,
  GameResultSubmit,
  DailyGameStats,
  BallLaunch,
} from './types/game';

// 常量配置
import { getDailyPointsLimit } from './config';
const SESSION_TTL = 5 * 60; // 5分钟
const COOLDOWN_TTL = 5; // 5秒
const MIN_GAME_DURATION = 10000; // 10秒
const BALLS_PER_GAME = 5;
const VALID_SLOT_SCORES = [5, 10, 20, 40, 80];
const MAX_POSSIBLE_SCORE = 400; // 80 * 5
const DAILY_STATS_TTL = 48 * 60 * 60; // 48小时
const MAX_RECORD_ENTRIES = 50;

// Key 格式
const SESSION_KEY = (sessionId: string) => `game:session:${sessionId}`;
const ACTIVE_SESSION_KEY = (userId: number) => `game:active:${userId}`;
const DAILY_STATS_KEY = (userId: number, date: string) => `game:daily:${userId}:${date}`;
const RECORDS_KEY = (userId: number) => `game:records:${userId}`;
const COOLDOWN_KEY = (userId: number) => `game:cooldown:${userId}`;
const SUBMIT_LOCK_KEY = (sessionId: string) => `game:submit:${sessionId}`;

/**
 * 生成随机种子
 */
function generateSeed(): string {
  return randomBytes(16).toString('hex');
}

/**
 * 检查用户是否在冷却中
 */
export async function isInCooldown(userId: number): Promise<boolean> {
  const cooldown = await kv.get(COOLDOWN_KEY(userId));
  return cooldown !== null;
}

/**
 * 获取冷却剩余时间（秒）
 */
export async function getCooldownRemaining(userId: number): Promise<number> {
  const ttl = await kv.ttl(COOLDOWN_KEY(userId));
  return ttl > 0 ? ttl : 0;
}

/**
 * 开始新游戏
 */
export async function startGame(
  userId: number
): Promise<{ success: boolean; session?: GameSession; message?: string }> {
  // 检查冷却
  if (await isInCooldown(userId)) {
    const remaining = await getCooldownRemaining(userId);
    return {
      success: false,
      message: `请等待 ${remaining} 秒后再开始游戏`,
    };
  }

  // 检查是否有未完成的会话
  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (activeSessionId) {
    const activeSession = await kv.get<GameSession>(SESSION_KEY(activeSessionId));
    
    // 如果会话不存在（已被 TTL 删除），清理 active key
    if (!activeSession) {
      await kv.del(ACTIVE_SESSION_KEY(userId));
    } else if (activeSession.status === 'playing') {
      // 检查会话是否过期
      if (Date.now() < activeSession.expiresAt) {
        return {
          success: false,
          message: '你已有正在进行的游戏',
        };
      }
      // 会话已过期，删除旧会话
      await kv.del(SESSION_KEY(activeSessionId));
      await kv.del(ACTIVE_SESSION_KEY(userId));
    }
  }

  // 创建新会话
  const now = Date.now();
  const session: GameSession = {
    id: nanoid(),
    userId,
    gameType: 'pachinko',
    seed: generateSeed(),
    startedAt: now,
    expiresAt: now + SESSION_TTL * 1000,
    status: 'playing',
  };

  // 保存会话
  await kv.set(SESSION_KEY(session.id), session, { ex: SESSION_TTL });
  await kv.set(ACTIVE_SESSION_KEY(userId), session.id, { ex: SESSION_TTL });

  return { success: true, session };
}

/**
 * 验证游戏结果
 */
export function validateGameResult(
  result: GameResultSubmit
): { valid: boolean; message?: string } {
  // 强类型校验
  if (!Number.isFinite(result.score) || !Number.isFinite(result.duration)) {
    return { valid: false, message: '无效的分数或时长数据' };
  }
  
  if (!Array.isArray(result.balls)) {
    return { valid: false, message: '无效的弹珠数据' };
  }

  // 检查弹珠数量
  if (result.balls.length !== BALLS_PER_GAME) {
    return { valid: false, message: `弹珠数量必须为 ${BALLS_PER_GAME}` };
  }

  // 注意：时长校验移到 submitGameResult 中使用服务端时间

  // 验证每颗弹珠
  let totalScore = 0;
  for (const ball of result.balls) {
    if (!ball || typeof ball !== 'object') {
      return { valid: false, message: '弹珠数据格式错误' };
    }
    
    // 强类型校验每个字段
    if (!Number.isFinite(ball.angle) || !Number.isFinite(ball.power) || 
        !Number.isFinite(ball.slotScore) || !Number.isFinite(ball.duration)) {
      return { valid: false, message: '弹珠数据包含无效数值' };
    }

    // 检查角度范围
    if (ball.angle < -30 || ball.angle > 30) {
      return { valid: false, message: '弹珠发射角度超出范围' };
    }

    // 检查力度范围
    if (ball.power < 0.5 || ball.power > 1.0) {
      return { valid: false, message: '弹珠发射力度超出范围' };
    }

    // 检查槽位分数有效性
    if (!VALID_SLOT_SCORES.includes(ball.slotScore)) {
      return { valid: false, message: '无效的槽位分数' };
    }

    // 检查弹珠持续时间
    if (ball.duration <= 0) {
      return { valid: false, message: '弹珠持续时间无效' };
    }

    totalScore += ball.slotScore;
  }

  // 验证总分
  if (result.score !== totalScore) {
    return { valid: false, message: '总分计算不匹配' };
  }

  // 检查分数范围
  if (result.score < 0 || result.score > MAX_POSSIBLE_SCORE) {
    return { valid: false, message: '分数超出有效范围' };
  }

  return { valid: true };
}

/**
 * 获取用户今日游戏统计
 */
export async function getDailyStats(userId: number): Promise<DailyGameStats> {
  const date = getTodayDateString();
  const stats = await kv.get<DailyGameStats>(DAILY_STATS_KEY(userId, date));

  if (stats) {
    return stats;
  }

  // 返回默认统计
  return {
    userId,
    date,
    gamesPlayed: 0,
    totalScore: 0,
    pointsEarned: 0,
    lastGameAt: 0,
  };
}

/**
 * 提交游戏结果
 */
export async function submitGameResult(
  userId: number,
  result: GameResultSubmit
): Promise<{ success: boolean; record?: GameRecord; pointsEarned?: number; message?: string }> {
  // 幂等锁：防止重复提交
  const lockKey = SUBMIT_LOCK_KEY(result.sessionId);
  const lockAcquired = await kv.set(lockKey, '1', { ex: SESSION_TTL, nx: true });
  if (!lockAcquired) {
    return { success: false, message: '请勿重复提交' };
  }

  // 获取会话
  const session = await kv.get<GameSession>(SESSION_KEY(result.sessionId));

  if (!session) {
    await kv.del(lockKey); // 释放幂等锁，允许重试
    return { success: false, message: '游戏会话不存在或已过期' };
  }

  if (session.userId !== userId) {
    await kv.del(lockKey); // 释放幂等锁
    return { success: false, message: '会话不属于该用户' };
  }

  if (session.status !== 'playing') {
    return { success: false, message: '游戏会话已结束' };
  }

  // 检查会话是否过期
  if (Date.now() > session.expiresAt) {
    await kv.del(SESSION_KEY(result.sessionId));
    await kv.del(lockKey); // 释放幂等锁
    return { success: false, message: '游戏会话已过期' };
  }

  // 验证游戏结果
  const validation = validateGameResult(result);
  if (!validation.valid) {
    await kv.del(lockKey); // 释放幂等锁，允许重试
    return { success: false, message: validation.message };
  }

  // 服务端时长校验（使用服务端计算的真实时长）
  const serverDuration = Date.now() - session.startedAt;
  if (serverDuration < MIN_GAME_DURATION) {
    await kv.del(lockKey); // 释放幂等锁，允许重试
    return { success: false, message: '游戏时长过短' };
  }

  // 获取今日统计
  const date = getTodayDateString();
  const dailyStats = await getDailyStats(userId);

  // 获取动态配置的每日积分上限
  const dailyPointsLimit = await getDailyPointsLimit();

  // 创建游戏记录（使用服务端计算的时长）
  // 使用原子化积分发放（先计算后记录）
  const pointsResult = await addGamePointsWithLimit(
    userId,
    result.score,
    dailyPointsLimit,
    'game_play',
    `弹珠游戏得分 ${result.score}`
  );
  const pointsEarned = pointsResult.pointsEarned;

  const record: GameRecord = {
    id: nanoid(),
    userId,
    sessionId: result.sessionId,
    gameType: 'pachinko',
    score: result.score,
    pointsEarned,
    duration: serverDuration, // 使用服务端时长，避免客户端伪造
    balls: result.balls.map((ball: BallLaunch) => ball.slotScore),
    createdAt: Date.now(),
  };

  // 删除会话（完成后不再需要）
  await kv.del(SESSION_KEY(result.sessionId));

  // 清除活跃会话标记
  await kv.del(ACTIVE_SESSION_KEY(userId));

  // 设置冷却
  await kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL });

  // 更新每日统计（游戏次数和分数统计，积分已由原子操作处理）
  const newDailyStats: DailyGameStats = {
    userId,
    date,
    gamesPlayed: dailyStats.gamesPlayed + 1,
    totalScore: dailyStats.totalScore + result.score,
    pointsEarned: pointsResult.dailyEarned, // 使用原子操作返回的准确值
    lastGameAt: Date.now(),
  };
  await kv.set(DAILY_STATS_KEY(userId, date), newDailyStats, { ex: DAILY_STATS_TTL });

  // 保存游戏记录
  await kv.lpush(RECORDS_KEY(userId), record);
  await kv.ltrim(RECORDS_KEY(userId), 0, MAX_RECORD_ENTRIES - 1);

  return { success: true, record, pointsEarned };
}

/**
 * 获取用户游戏记录
 */
export async function getGameRecords(
  userId: number,
  limit: number = 20
): Promise<GameRecord[]> {
  const records = await kv.lrange<GameRecord>(RECORDS_KEY(userId), 0, limit - 1);
  return records ?? [];
}

/**
 * 获取用户当前活跃会话
 */
export async function getActiveSession(userId: number): Promise<GameSession | null> {
  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) return null;
  
  const session = await kv.get<GameSession>(SESSION_KEY(activeSessionId));
  if (!session) {
    // 清理孤立的 active key
    await kv.del(ACTIVE_SESSION_KEY(userId));
    return null;
  }
  
  return session;
}

/**
 * 取消/放弃当前游戏
 */
export async function cancelGame(userId: number): Promise<{ success: boolean; message?: string }> {
  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  
  if (!activeSessionId) {
    return { success: false, message: '没有正在进行的游戏' };
  }
  
  // 删除会话
  await kv.del(SESSION_KEY(activeSessionId));
  await kv.del(ACTIVE_SESSION_KEY(userId));
  
  // 设置短暂冷却防止滥用
  await kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL });
  
  return { success: true };
}
