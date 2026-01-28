// src/lib/memory.ts - 记忆卡片游戏后端逻辑

import { randomBytes, createHash } from 'crypto';
import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import { addGamePointsWithLimit } from './points';
import { getTodayDateString } from './time';
import { getDailyPointsLimit } from './config';
import type {
  MemoryDifficulty,
  MemoryDifficultyConfig,
  MemoryGameSession,
  MemoryGameResultSubmit,
  MemoryGameRecord,
  DailyGameStats,
} from './types/game';

// ============ 常量配置 ============

const SESSION_TTL = 5 * 60; // 5分钟
const COOLDOWN_TTL = 5; // 5秒
const MIN_GAME_DURATION = 5000; // 5秒（记忆游戏可以更快）
const DAILY_STATS_TTL = 48 * 60 * 60; // 48小时
const MAX_RECORD_ENTRIES = 50;

// 难度配置
export const DIFFICULTY_CONFIG: Record<MemoryDifficulty, MemoryDifficultyConfig> = {
  easy: {
    rows: 4,
    cols: 4,
    pairs: 8,
    baseScore: 120,
    penaltyPerMove: 1,
    minScore: 30,
    timeLimit: 180,
  },
  normal: {
    rows: 4,
    cols: 6,
    pairs: 12,
    baseScore: 200,
    penaltyPerMove: 2,
    minScore: 50,
    timeLimit: 180,
  },
  hard: {
    rows: 6,
    cols: 6,
    pairs: 18,
    baseScore: 350,
    penaltyPerMove: 2,
    minScore: 80,
    timeLimit: 180,
  },
};

// 卡片图标ID列表（对应 react-icons/gi 中的图标）
export const CARD_ICONS = [
  'apple', 'banana', 'cherry', 'grapes', 'strawberry',
  'watermelon', 'orange', 'pear', 'peach', 'lemon',
  'carrot', 'corn', 'pepper', 'mushroom', 'broccoli',
  'cat', 'dog', 'rabbit', 'bear', 'bird',
  'fish', 'butterfly', 'bee', 'turtle', 'frog',
];

// Key 格式
const SESSION_KEY = (sessionId: string) => `memory:session:${sessionId}`;
const ACTIVE_SESSION_KEY = (userId: number) => `memory:active:${userId}`;
const DAILY_STATS_KEY = (userId: number, date: string) => `game:daily:${userId}:${date}`;
const RECORDS_KEY = (userId: number) => `memory:records:${userId}`;
const COOLDOWN_KEY = (userId: number) => `memory:cooldown:${userId}`;
const SUBMIT_LOCK_KEY = (sessionId: string) => `memory:submit:${sessionId}`;

// ============ 工具函数 ============

/**
 * 生成随机种子
 */
function generateSeed(): string {
  return randomBytes(16).toString('hex');
}

/**
 * 基于种子的伪随机数生成器
 */
function seededRandom(seed: string, index: number): number {
  const hash = createHash('sha256').update(`${seed}-${index}`).digest();
  // 使用 0x100000000 确保结果始终 < 1
  return hash.readUInt32BE(0) / 0x100000000;
}

/**
 * 基于种子洗牌算法 (Fisher-Yates)
 */
function shuffleWithSeed<T>(array: T[], seed: string): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom(seed, i) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 生成卡片布局
 */
export function generateCardLayout(difficulty: MemoryDifficulty, seed: string): string[] {
  const config = DIFFICULTY_CONFIG[difficulty];
  const totalCards = config.rows * config.cols;
  const pairs = config.pairs;
  
  // 选择图标
  const selectedIcons = CARD_ICONS.slice(0, pairs);
  
  // 创建成对的卡片
  const cards = [...selectedIcons, ...selectedIcons];
  
  // 如果卡片数量不够，用随机图标填充（不应该发生）
  while (cards.length < totalCards) {
    cards.push(selectedIcons[0]);
  }
  
  // 洗牌
  return shuffleWithSeed(cards, seed);
}

/**
 * 计算得分
 */
export function calculateScore(
  difficulty: MemoryDifficulty,
  moves: number,
  completed: boolean
): number {
  if (!completed) return 0;
  
  const config = DIFFICULTY_CONFIG[difficulty];
  const optimalMoves = config.pairs; // 最优步数 = 对数
  const extraMoves = Math.max(0, moves - optimalMoves);
  const score = config.baseScore - extraMoves * config.penaltyPerMove;
  
  return Math.max(config.minScore, score);
}

// ============ 核心函数 ============

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
 * 获取用户今日游戏统计（共享）
 */
export async function getDailyStats(userId: number): Promise<DailyGameStats> {
  const date = getTodayDateString();
  const stats = await kv.get<DailyGameStats>(DAILY_STATS_KEY(userId, date));

  if (stats) {
    return stats;
  }

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
 * 开始新游戏
 */
export async function startMemoryGame(
  userId: number,
  difficulty: MemoryDifficulty
): Promise<{ success: boolean; session?: MemoryGameSession; message?: string }> {
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
    const activeSession = await kv.get<MemoryGameSession>(SESSION_KEY(activeSessionId));
    
    if (!activeSession) {
      await kv.del(ACTIVE_SESSION_KEY(userId));
    } else if (activeSession.status === 'playing') {
      if (Date.now() < activeSession.expiresAt) {
        return {
          success: false,
          message: '你已有正在进行的游戏',
        };
      }
      await kv.del(SESSION_KEY(activeSessionId));
      await kv.del(ACTIVE_SESSION_KEY(userId));
    }
  }

  // 创建新会话
  const now = Date.now();
  const seed = generateSeed();
  const cardLayout = generateCardLayout(difficulty, seed);
  
  const session: MemoryGameSession = {
    id: nanoid(),
    userId,
    gameType: 'memory',
    difficulty,
    seed,
    cardLayout,
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
 * 获取当前活跃会话
 */
export async function getActiveMemorySession(userId: number): Promise<MemoryGameSession | null> {
  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) return null;
  
  const session = await kv.get<MemoryGameSession>(SESSION_KEY(activeSessionId));
  if (!session) {
    await kv.del(ACTIVE_SESSION_KEY(userId));
    return null;
  }
  
  return session;
}

/**
 * 取消游戏
 */
export async function cancelMemoryGame(userId: number): Promise<{ success: boolean; message?: string }> {
  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  
  if (!activeSessionId) {
    return { success: false, message: '没有正在进行的游戏' };
  }
  
  await kv.del(SESSION_KEY(activeSessionId));
  await kv.del(ACTIVE_SESSION_KEY(userId));
  await kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL });
  
  return { success: true };
}

/**
 * 验证游戏结果
 */
export function validateMemoryResult(
  session: MemoryGameSession,
  result: MemoryGameResultSubmit
): { valid: boolean; message?: string } {
  const config = DIFFICULTY_CONFIG[session.difficulty];
  const totalCards = config.rows * config.cols;
  
  // 检查操作序列
  if (!Array.isArray(result.moves)) {
    return { valid: false, message: '无效的操作数据' };
  }
  
  // 检查 completed 是否为布尔值
  if (typeof result.completed !== 'boolean') {
    return { valid: false, message: '无效的完成状态' };
  }
  
  // 步数范围检查（仅对已完成的游戏要求最少步数）
  const maxMoves = config.pairs * 10;
  if (result.moves.length > maxMoves) {
    return { valid: false, message: '操作步数异常' };
  }
  
  // 如果声称已完成，至少需要 pairs 步
  if (result.completed && result.moves.length < config.pairs) {
    return { valid: false, message: '操作步数不足以完成游戏' };
  }
  
  // 重放验证
  const matchedCards = new Set<number>();
  
  for (const move of result.moves) {
    // P0: 严格类型检查 - 防止非整数索引绕过验证
    if (!Number.isInteger(move.card1) || !Number.isInteger(move.card2)) {
      return { valid: false, message: '无效的卡片索引类型' };
    }
    
    if (typeof move.matched !== 'boolean') {
      return { valid: false, message: '无效的匹配标记类型' };
    }
    
    // 检查卡片索引有效性
    if (move.card1 < 0 || move.card1 >= totalCards ||
        move.card2 < 0 || move.card2 >= totalCards) {
      return { valid: false, message: '无效的卡片索引' };
    }
    
    // 不能翻同一张卡
    if (move.card1 === move.card2) {
      return { valid: false, message: '不能翻同一张卡' };
    }
    
    // 不能翻已匹配的卡
    if (matchedCards.has(move.card1) || matchedCards.has(move.card2)) {
      return { valid: false, message: '该卡片已被匹配' };
    }
    
    // 验证匹配结果
    const icon1 = session.cardLayout[move.card1];
    const icon2 = session.cardLayout[move.card2];
    
    // 防止 undefined 比较
    if (icon1 === undefined || icon2 === undefined) {
      return { valid: false, message: '卡片数据异常' };
    }
    
    const shouldMatch = icon1 === icon2;
    
    if (move.matched !== shouldMatch) {
      return { valid: false, message: '匹配结果不一致' };
    }
    
    if (move.matched) {
      matchedCards.add(move.card1);
      matchedCards.add(move.card2);
    }
  }
  
  // 验证完成状态 - 使用 matchedCards.size === totalCards 更严格
  const actuallyCompleted = matchedCards.size === totalCards;
  if (result.completed !== actuallyCompleted) {
    return { valid: false, message: '完成状态不一致' };
  }
  
  return { valid: true };
}

/**
 * 提交游戏结果
 */
export async function submitMemoryResult(
  userId: number,
  result: MemoryGameResultSubmit
): Promise<{ success: boolean; record?: MemoryGameRecord; pointsEarned?: number; message?: string }> {
  // 幂等锁
  const lockKey = SUBMIT_LOCK_KEY(result.sessionId);
  const lockAcquired = await kv.set(lockKey, '1', { ex: SESSION_TTL, nx: true });
  if (!lockAcquired) {
    return { success: false, message: '请勿重复提交' };
  }

  // 获取会话
  const session = await kv.get<MemoryGameSession>(SESSION_KEY(result.sessionId));

  if (!session) {
    await kv.del(lockKey);
    return { success: false, message: '游戏会话不存在或已过期' };
  }

  if (session.userId !== userId) {
    await kv.del(lockKey);
    return { success: false, message: '会话不属于该用户' };
  }

  if (session.status !== 'playing') {
    return { success: false, message: '游戏会话已结束' };
  }

  if (Date.now() > session.expiresAt) {
    await kv.del(SESSION_KEY(result.sessionId));
    await kv.del(lockKey);
    return { success: false, message: '游戏会话已过期' };
  }

  // 验证结果
  const validation = validateMemoryResult(session, result);
  if (!validation.valid) {
    await kv.del(lockKey);
    return { success: false, message: validation.message };
  }

  // 服务端时长校验
  const serverDuration = Date.now() - session.startedAt;
  if (serverDuration < MIN_GAME_DURATION) {
    await kv.del(lockKey);
    return { success: false, message: '游戏时长过短' };
  }

  // 计算得分
  const score = calculateScore(session.difficulty, result.moves.length, result.completed);

  // 获取今日统计
  const date = getTodayDateString();
  const dailyStats = await getDailyStats(userId);

  // 获取动态配置的每日积分上限
  const dailyPointsLimit = await getDailyPointsLimit();

  // 使用原子化积分发放
  const pointsResult = await addGamePointsWithLimit(
    userId,
    score,
    dailyPointsLimit,
    'game_play',
    `记忆游戏得分 ${score}`
  );
  const pointsEarned = pointsResult.pointsEarned;

  // 创建游戏记录
  const record: MemoryGameRecord = {
    id: nanoid(),
    userId,
    sessionId: result.sessionId,
    gameType: 'memory',
    difficulty: session.difficulty,
    moves: result.moves.length,
    completed: result.completed,
    score,
    pointsEarned,
    duration: serverDuration,
    createdAt: Date.now(),
  };

  // 清理会话
  await kv.del(SESSION_KEY(result.sessionId));
  await kv.del(ACTIVE_SESSION_KEY(userId));
  await kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL });

  // 更新每日统计（游戏次数和分数统计，积分已由原子操作处理）
  const newDailyStats: DailyGameStats = {
    userId,
    date,
    gamesPlayed: dailyStats.gamesPlayed + 1,
    totalScore: dailyStats.totalScore + score,
    pointsEarned: pointsResult.dailyEarned, // 使用原子操作返回的准确值
    lastGameAt: Date.now(),
  };
  await kv.set(DAILY_STATS_KEY(userId, date), newDailyStats, { ex: DAILY_STATS_TTL });

  // 保存记录
  await kv.lpush(RECORDS_KEY(userId), record);
  await kv.ltrim(RECORDS_KEY(userId), 0, MAX_RECORD_ENTRIES - 1);

  return { success: true, record, pointsEarned };
}

/**
 * 获取用户游戏记录
 */
export async function getMemoryRecords(
  userId: number,
  limit: number = 20
): Promise<MemoryGameRecord[]> {
  const records = await kv.lrange<MemoryGameRecord>(RECORDS_KEY(userId), 0, limit - 1);
  return records ?? [];
}
