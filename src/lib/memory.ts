// src/lib/memory.ts - 记忆卡片游戏后端逻辑

import { randomBytes, createHash } from 'crypto';
import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import { addGamePointsWithLimit } from './points';
import { getTodayDateString } from './time';
import { getDailyPointsLimit } from './config';
import { incrementSharedDailyStats } from './daily-stats';
import type {
  MemoryDifficulty,
  MemoryDifficultyConfig,
  MemoryFlipResult,
  MemoryGameSession,
  MemoryGameResultSubmit,
  MemoryRevealedCard,
  MemoryGameRecord,
  DailyGameStats,
  MemoryMove,
} from './types/game';

// ============ 常量配置 ============

const SESSION_TTL = 5 * 60; // 5分钟
const COOLDOWN_TTL = 5; // 5秒
const MIN_GAME_DURATION = 5000; // 5秒（记忆游戏可以更快）
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
const FLIP_LOCK_KEY = (sessionId: string) => `memory:flip:${sessionId}`;
const FLIP_LOCK_TTL = 3;

export const MEMORY_REVEALED_SENTINEL = '__hidden__';

function normalizeSession(session: MemoryGameSession): MemoryGameSession {
  return {
    ...session,
    firstFlippedCard: session.firstFlippedCard ?? null,
    matchedCards: Array.isArray(session.matchedCards) ? session.matchedCards : [],
    moveLog: Array.isArray(session.moveLog) ? session.moveLog : [],
  };
}

function getTotalCardsByDifficulty(difficulty: MemoryDifficulty): number {
  const config = DIFFICULTY_CONFIG[difficulty];
  return config.rows * config.cols;
}

function ensureMoveTimestamp(move: MemoryMove): MemoryMove {
  return {
    ...move,
    timestamp: Number.isFinite(move.timestamp) ? move.timestamp : Date.now(),
  };
}

export function maskCardLayout(layout: string[]): string[] {
  return layout.map(() => MEMORY_REVEALED_SENTINEL);
}

export function buildRevealedCards(session: MemoryGameSession): MemoryRevealedCard[] {
  const normalized = normalizeSession(session);
  return normalized.matchedCards!
    .filter((index) => Number.isInteger(index) && index >= 0 && index < normalized.cardLayout.length)
    .map((index) => ({ index, iconId: normalized.cardLayout[index]! }));
}

export function buildMemorySessionView(session: MemoryGameSession): {
  cardLayout: string[];
  matchedCards: number[];
  firstFlippedCard: number | null;
  moveCount: number;
} {
  const normalized = normalizeSession(session);
  const viewLayout = maskCardLayout(normalized.cardLayout);

  for (const card of buildRevealedCards(normalized)) {
    viewLayout[card.index] = card.iconId;
  }

  const firstFlippedCard = normalized.firstFlippedCard;
  if (
    typeof firstFlippedCard === 'number' &&
    firstFlippedCard >= 0 &&
    firstFlippedCard < normalized.cardLayout.length
  ) {
    viewLayout[firstFlippedCard] = normalized.cardLayout[firstFlippedCard]!;
  }

  return {
    cardLayout: viewLayout,
    matchedCards: [...normalized.matchedCards!],
    firstFlippedCard: normalized.firstFlippedCard ?? null,
    moveCount: normalized.moveLog!.length,
  };
}

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
    firstFlippedCard: null,
    matchedCards: [],
    moveLog: [],
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
  
  return normalizeSession(session);
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
  const normalizedSession = normalizeSession(session);
  const config = DIFFICULTY_CONFIG[normalizedSession.difficulty];
  const totalCards = config.rows * config.cols;
  const authoritativeMoves = normalizedSession.moveLog ?? [];
  
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
  if (authoritativeMoves.length > maxMoves) {
    return { valid: false, message: '操作步数异常' };
  }
  
  // 如果声称已完成，至少需要 pairs 步
  if (result.completed && authoritativeMoves.length < config.pairs) {
    return { valid: false, message: '操作步数不足以完成游戏' };
  }
  
  // 重放验证
  const matchedCards = new Set<number>();
  
  for (const move of authoritativeMoves) {
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
    const icon1 = normalizedSession.cardLayout[move.card1];
    const icon2 = normalizedSession.cardLayout[move.card2];
    
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

  const expectedMatched = new Set<number>(normalizedSession.matchedCards);
  if (expectedMatched.size !== matchedCards.size) {
    return { valid: false, message: '服务端匹配记录不一致' };
  }

  for (const index of matchedCards) {
    if (!expectedMatched.has(index)) {
      return { valid: false, message: '服务端匹配记录不一致' };
    }
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

  const normalizedSession = normalizeSession(session);

  if (normalizedSession.userId !== userId) {
    await kv.del(lockKey);
    return { success: false, message: '会话不属于该用户' };
  }

  if (normalizedSession.status !== 'playing') {
    return { success: false, message: '游戏会话已结束' };
  }

  if (normalizedSession.firstFlippedCard !== null && normalizedSession.firstFlippedCard !== undefined) {
    await kv.del(lockKey);
    return { success: false, message: '存在未完成翻牌，请完成后再结算' };
  }

  if (Date.now() > normalizedSession.expiresAt) {
    await kv.del(SESSION_KEY(result.sessionId));
    await kv.del(lockKey);
    return { success: false, message: '游戏会话已过期' };
  }

  // 验证结果
  const validation = validateMemoryResult(normalizedSession, result);
  if (!validation.valid) {
    await kv.del(lockKey);
    return { success: false, message: validation.message };
  }

  // 服务端时长校验
  const serverDuration = Date.now() - normalizedSession.startedAt;
  if (serverDuration < MIN_GAME_DURATION) {
    await kv.del(lockKey);
    return { success: false, message: '游戏时长过短' };
  }

  // 计算得分
  const authoritativeMoves = normalizedSession.moveLog ?? [];

  if (result.moves.length > 0 && result.moves.length !== authoritativeMoves.length) {
    await kv.del(lockKey);
    return { success: false, message: '提交步数与服务端记录不一致' };
  }

  if (result.moves.length > 0) {
    for (let i = 0; i < authoritativeMoves.length; i++) {
      const expected = authoritativeMoves[i];
      const actual = result.moves[i];
      if (
        !actual ||
        expected.card1 !== actual.card1 ||
        expected.card2 !== actual.card2 ||
        expected.matched !== actual.matched
      ) {
        await kv.del(lockKey);
        return { success: false, message: '提交步数与服务端记录不一致' };
      }
    }
  }

  const score = calculateScore(normalizedSession.difficulty, authoritativeMoves.length, result.completed);
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
    difficulty: normalizedSession.difficulty,
    moves: authoritativeMoves.length,
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
  await incrementSharedDailyStats(userId, score, pointsResult.dailyEarned);

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

/**
 * 服务端翻牌：不向客户端暴露完整布局
 */
export async function flipMemoryCard(
  userId: number,
  sessionId: string,
  cardIndex: number
): Promise<{ success: boolean; data?: MemoryFlipResult; message?: string }> {
  if (!Number.isInteger(cardIndex)) {
    return { success: false, message: '无效的卡片索引' };
  }

  const lockKey = FLIP_LOCK_KEY(sessionId);
  const lockAcquired = await kv.set(lockKey, '1', { ex: FLIP_LOCK_TTL, nx: true });
  if (!lockAcquired) {
    return { success: false, message: '翻牌处理中，请稍后再试' };
  }

  try {
    const session = await kv.get<MemoryGameSession>(SESSION_KEY(sessionId));
    if (!session) {
      return { success: false, message: '游戏会话不存在或已过期' };
    }

    const normalizedSession = normalizeSession(session);

    if (normalizedSession.userId !== userId) {
      return { success: false, message: '会话不属于该用户' };
    }

    if (normalizedSession.status !== 'playing') {
      return { success: false, message: '游戏会话已结束' };
    }

    if (Date.now() > normalizedSession.expiresAt) {
      await kv.del(SESSION_KEY(sessionId));
      await kv.del(ACTIVE_SESSION_KEY(userId));
      return { success: false, message: '游戏会话已过期' };
    }

    const totalCards = getTotalCardsByDifficulty(normalizedSession.difficulty);
    if (cardIndex < 0 || cardIndex >= totalCards) {
      return { success: false, message: '无效的卡片索引' };
    }

    const matchedSet = new Set<number>(normalizedSession.matchedCards);
    if (matchedSet.has(cardIndex)) {
      return { success: false, message: '该卡片已配对' };
    }

    const now = Date.now();
    const cardIcon = normalizedSession.cardLayout[cardIndex];
    if (!cardIcon) {
      return { success: false, message: '卡片数据异常' };
    }

    const firstFlippedCard = normalizedSession.firstFlippedCard;
    if (firstFlippedCard === cardIndex) {
      return { success: false, message: '不能重复翻开同一张卡片' };
    }

    if (firstFlippedCard === null || firstFlippedCard === undefined) {
      const nextSession: MemoryGameSession = {
        ...normalizedSession,
        firstFlippedCard: cardIndex,
      };

      const ttlSeconds = Math.max(1, Math.ceil((normalizedSession.expiresAt - now) / 1000));
      await kv.set(SESSION_KEY(sessionId), nextSession, { ex: ttlSeconds });

      return {
        success: true,
        data: {
          cardIndex,
          iconId: cardIcon,
          matched: false,
          completed: matchedSet.size === totalCards,
          moveCount: normalizedSession.moveLog!.length,
          matchedCount: matchedSet.size,
        },
      };
    }

    if (firstFlippedCard < 0 || firstFlippedCard >= normalizedSession.cardLayout.length) {
      const repairedSession: MemoryGameSession = {
        ...normalizedSession,
        firstFlippedCard: null,
      };
      const ttlSeconds = Math.max(1, Math.ceil((normalizedSession.expiresAt - now) / 1000));
      await kv.set(SESSION_KEY(sessionId), repairedSession, { ex: ttlSeconds });
      return { success: false, message: '会话状态异常，请重试' };
    }

    const firstCardIcon = normalizedSession.cardLayout[firstFlippedCard];
    if (!firstCardIcon) {
      return { success: false, message: '卡片数据异常' };
    }

    const isMatch = firstCardIcon === cardIcon;
    const move = ensureMoveTimestamp({
      card1: firstFlippedCard,
      card2: cardIndex,
      matched: isMatch,
      timestamp: now,
    });

    if (isMatch) {
      matchedSet.add(firstFlippedCard);
      matchedSet.add(cardIndex);
    }

    const newMoveLog = [...normalizedSession.moveLog!, move];
    const newMatchedCards = Array.from(matchedSet).sort((a, b) => a - b);
    const completed = newMatchedCards.length === totalCards;

    const nextSession: MemoryGameSession = {
      ...normalizedSession,
      firstFlippedCard: null,
      matchedCards: newMatchedCards,
      moveLog: newMoveLog,
    };

    const ttlSeconds = Math.max(1, Math.ceil((normalizedSession.expiresAt - now) / 1000));
    await kv.set(SESSION_KEY(sessionId), nextSession, { ex: ttlSeconds });

    return {
      success: true,
      data: {
        cardIndex,
        iconId: cardIcon,
        firstCardIndex: firstFlippedCard,
        firstCardIconId: firstCardIcon,
        matched: isMatch,
        completed,
        moveCount: newMoveLog.length,
        matchedCount: newMatchedCards.length,
        move,
      },
    };
  } finally {
    try {
      await kv.del(lockKey);
    } catch (lockReleaseError) {
      console.error('Memory flip lock release failed:', lockReleaseError);
    }
  }
}

