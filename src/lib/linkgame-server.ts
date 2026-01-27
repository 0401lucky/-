// src/lib/linkgame-server.ts - 连连看游戏后端逻辑

import { randomBytes } from 'crypto';
import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import { addGamePointsWithLimit } from './points';
import { getTodayDateString } from './time';
import { getDailyPointsLimit } from './config';
import {
  generateTileLayout,
  LINKGAME_DIFFICULTY_CONFIG,
  canMatch,
  removeMatch,
  canTripleMatch,
  removeTripleMatch,
  checkGameComplete,
  calculateScore,
  indexOf,
  shuffleBoard,
} from './linkgame';
import type {
  LinkGameDifficulty,
  LinkGameSession,
  LinkGameResultSubmit,
  LinkGameRecord,
  LinkGamePosition,
  DailyGameStats,
} from './types/game';

// ============ 常量配置 ============

const SESSION_TTL = 5 * 60; // 5分钟
const COOLDOWN_TTL = 5; // 5秒
const MIN_GAME_DURATION = 5000; // 5秒
const DAILY_STATS_TTL = 48 * 60 * 60; // 48小时
const MAX_RECORD_ENTRIES = 50;

// Key 格式
const SESSION_KEY = (sessionId: string) => `linkgame:session:${sessionId}`;
const ACTIVE_SESSION_KEY = (userId: number) => `linkgame:active:${userId}`;
const DAILY_STATS_KEY = (userId: number, date: string) => `game:daily:${userId}:${date}`;
const RECORDS_KEY = (userId: number) => `linkgame:records:${userId}`;
const COOLDOWN_KEY = (userId: number) => `linkgame:cooldown:${userId}`;
const SUBMIT_LOCK_KEY = (sessionId: string) => `linkgame:submit:${sessionId}`;

// ============ 工具函数 ============

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

// ============ 纯验证函数（可单独测试） ============

export interface ValidationResult {
  ok: boolean;
  message?: string;
  matchedPairs?: number;
  maxStreak?: number;
  completed?: boolean;
  shufflesUsed?: number;
}

/**
 * 验证连连看游戏结果（纯函数，无KV依赖）
 * 通过重放操作序列验证结果的合法性
 */
export function validateLinkGameResult(
  session: LinkGameSession,
  payload: LinkGameResultSubmit
): ValidationResult {
  const config = LINKGAME_DIFFICULTY_CONFIG[session.difficulty];
  const { rows, cols, hintLimit, shuffleLimit } = config;

  // 基础类型检查
  if (!Array.isArray(payload.moves)) {
    return { ok: false, message: '无效的操作数据' };
  }

  if (typeof payload.completed !== 'boolean') {
    return { ok: false, message: '无效的完成状态' };
  }

  // 检查 hintsUsed 和 shufflesUsed
  if (!Number.isInteger(payload.hintsUsed) || payload.hintsUsed < 0) {
    return { ok: false, message: '无效的提示使用次数' };
  }
  if (!Number.isInteger(payload.shufflesUsed) || payload.shufflesUsed < 0) {
    return { ok: false, message: '无效的洗牌使用次数' };
  }
  if (payload.hintsUsed > hintLimit) {
    return { ok: false, message: '提示使用次数超过限制' };
  }
  if (payload.shufflesUsed > shuffleLimit) {
    return { ok: false, message: '洗牌使用次数超过限制' };
  }

  // 重放验证
  let board: (string | null)[] = [...session.tileLayout];
  let matchedPairs = 0;
  let currentStreak = 0;
  let maxStreak = 0;
  let serverShufflesUsed = 0;

  for (const move of payload.moves) {
    // 类型检查
    if (!move || typeof move !== 'object') {
      return { ok: false, message: '无效的操作格式' };
    }

    // Handle shuffle moves
    const moveType = (move as { type?: string }).type;
    if (moveType === 'shuffle') {
      serverShufflesUsed++;
      if (serverShufflesUsed > shuffleLimit) {
        return { ok: false, message: '洗牌次数超过限制' };
      }
      // Apply shuffle with deterministic seed matching client
      const shuffleSeed = `${session.id}-shuffle-${serverShufflesUsed}`;
      board = shuffleBoard(board, shuffleSeed);
      currentStreak = 0;
      continue;
    }

    // Handle match moves (including legacy format without type field)
    const matchMove = move as { pos1?: LinkGamePosition; pos2?: LinkGamePosition; pos3?: LinkGamePosition; matched?: boolean; isTriple?: boolean };
    const { pos1, pos2, pos3, matched } = matchMove;

    // 位置类型检查
    if (!pos1 || !pos2 || typeof pos1 !== 'object' || typeof pos2 !== 'object') {
      return { ok: false, message: '无效的位置数据' };
    }

    if (!Number.isInteger(pos1.row) || !Number.isInteger(pos1.col) ||
        !Number.isInteger(pos2.row) || !Number.isInteger(pos2.col)) {
      return { ok: false, message: '位置坐标必须为整数' };
    }

    if (typeof matched !== 'boolean') {
      return { ok: false, message: '无效的匹配标记' };
    }

    // 边界检查
    if (pos1.row < 0 || pos1.row >= rows || pos1.col < 0 || pos1.col >= cols) {
      return { ok: false, message: '位置1超出边界' };
    }
    if (pos2.row < 0 || pos2.row >= rows || pos2.col < 0 || pos2.col >= cols) {
      return { ok: false, message: '位置2超出边界' };
    }

    // 不能选同一个位置
    const idx1 = indexOf(pos1, cols);
    const idx2 = indexOf(pos2, cols);
    if (idx1 === idx2) {
      return { ok: false, message: '不能选择同一个位置' };
    }

    // 检查两个位置是否有瓦片
    if (board[idx1] === null) {
      return { ok: false, message: '位置1没有瓦片' };
    }
    if (board[idx2] === null) {
      return { ok: false, message: '位置2没有瓦片' };
    }

    if (pos3 && typeof pos3 === 'object') {
      if (!Number.isInteger(pos3.row) || !Number.isInteger(pos3.col)) {
        return { ok: false, message: '位置3坐标必须为整数' };
      }
      if (pos3.row < 0 || pos3.row >= rows || pos3.col < 0 || pos3.col >= cols) {
        return { ok: false, message: '位置3超出边界' };
      }
      const idx3 = indexOf(pos3, cols);
      if (idx3 === idx1 || idx3 === idx2) {
        return { ok: false, message: '不能选择相同位置' };
      }
      if (board[idx3] === null) {
        return { ok: false, message: '位置3没有瓦片' };
      }

      const serverCanTripleMatch = canTripleMatch(board, pos1, pos2, pos3, cols);
      if (matched !== serverCanTripleMatch) {
        return { ok: false, message: '三消匹配结果不一致' };
      }

      if (matched) {
        board = removeTripleMatch(board, pos1, pos2, pos3, cols);
        matchedPairs += 2;
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    } else {
      const serverCanMatch = canMatch(board, pos1, pos2, cols);
      if (matched !== serverCanMatch) {
        return { ok: false, message: '匹配结果不一致' };
      }

      if (matched) {
        board = removeMatch(board, pos1, pos2, cols);
        matchedPairs++;
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
  }

  // 验证完成状态
  const actuallyCompleted = checkGameComplete(board);
  if (payload.completed !== actuallyCompleted) {
    return { ok: false, message: '完成状态不一致' };
  }

  return {
    ok: true,
    matchedPairs,
    maxStreak,
    completed: actuallyCompleted,
    shufflesUsed: serverShufflesUsed,
  };
}

// ============ 核心函数 ============

/**
 * 开始新游戏
 */
export async function startLinkGame(
  userId: number,
  difficulty: LinkGameDifficulty
): Promise<{ success: boolean; session?: LinkGameSession; message?: string }> {
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
    const activeSession = await kv.get<LinkGameSession>(SESSION_KEY(activeSessionId));

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
  const tileLayout = generateTileLayout(difficulty, seed);

  const session: LinkGameSession = {
    id: nanoid(),
    userId,
    gameType: 'linkgame',
    difficulty,
    seed,
    tileLayout,
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
export async function getActiveLinkGameSession(userId: number): Promise<LinkGameSession | null> {
  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) return null;

  const session = await kv.get<LinkGameSession>(SESSION_KEY(activeSessionId));
  if (!session) {
    await kv.del(ACTIVE_SESSION_KEY(userId));
    return null;
  }

  return session;
}

/**
 * 取消游戏
 */
export async function cancelLinkGame(userId: number): Promise<{ success: boolean; message?: string }> {
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
 * 提交游戏结果
 */
export async function submitLinkGameResult(
  userId: number,
  payload: LinkGameResultSubmit
): Promise<{ success: boolean; record?: LinkGameRecord; pointsEarned?: number; message?: string }> {
  // 幂等锁
  const lockKey = SUBMIT_LOCK_KEY(payload.sessionId);
  const lockAcquired = await kv.set(lockKey, '1', { ex: SESSION_TTL, nx: true });
  if (!lockAcquired) {
    return { success: false, message: '请勿重复提交' };
  }

  // 获取会话
  const session = await kv.get<LinkGameSession>(SESSION_KEY(payload.sessionId));

  if (!session) {
    await kv.del(lockKey);
    return { success: false, message: '游戏会话不存在或已过期' };
  }

  if (session.userId !== userId) {
    await kv.del(lockKey);
    return { success: false, message: '会话不属于该用户' };
  }

  if (session.status !== 'playing') {
    await kv.del(lockKey);
    return { success: false, message: '游戏会话已结束' };
  }

  if (Date.now() > session.expiresAt) {
    await kv.del(SESSION_KEY(payload.sessionId));
    await kv.del(lockKey);
    return { success: false, message: '游戏会话已过期' };
  }

  // 验证结果
  const validation = validateLinkGameResult(session, payload);
  if (!validation.ok) {
    await kv.del(lockKey);
    return { success: false, message: validation.message };
  }

  // 服务端时长校验
  const serverDuration = Date.now() - session.startedAt;
  if (serverDuration < MIN_GAME_DURATION) {
    await kv.del(lockKey);
    return { success: false, message: '游戏时长过短' };
  }

  // 计算得分（服务端计算，不信任客户端）
  const config = LINKGAME_DIFFICULTY_CONFIG[session.difficulty];
  let score = 0;

  if (validation.completed) {
    // combo = max(0, maxStreak - 1)
    const combo = Math.max(0, (validation.maxStreak ?? 0) - 1);
    const timeRemainingSeconds = Math.max(0, config.timeLimit - Math.floor(serverDuration / 1000));

    // Use server-counted shufflesUsed for scoring (don't trust client)
    const validatedShufflesUsed = validation.shufflesUsed ?? 0;
    score = calculateScore({
      matchedPairs: validation.matchedPairs ?? 0,
      baseScore: config.baseScore,
      combo,
      timeRemainingSeconds,
      hintsUsed: payload.hintsUsed,
      shufflesUsed: validatedShufflesUsed,
      hintPenalty: config.hintPenalty,
      shufflePenalty: config.shufflePenalty,
    });
  }

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
    `连连看得分 ${score}`
  );
  const pointsEarned = pointsResult.pointsEarned;

  // 创建游戏记录
  const record: LinkGameRecord = {
    id: nanoid(),
    userId,
    sessionId: payload.sessionId,
    gameType: 'linkgame',
    difficulty: session.difficulty,
    moves: payload.moves.length,
    completed: validation.completed ?? false,
    score,
    pointsEarned,
    duration: serverDuration,
    createdAt: Date.now(),
  };

  // 清理会话
  await kv.del(SESSION_KEY(payload.sessionId));
  await kv.del(ACTIVE_SESSION_KEY(userId));
  await kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL });

  // 更新每日统计（游戏次数和分数统计，积分已由原子操作处理）
  const newDailyStats: DailyGameStats = {
    userId,
    date,
    gamesPlayed: dailyStats.gamesPlayed + 1,
    totalScore: dailyStats.totalScore + score,
    pointsEarned: pointsResult.dailyEarned,
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
export async function getLinkGameRecords(
  userId: number,
  limit: number = 20
): Promise<LinkGameRecord[]> {
  const records = await kv.lrange<LinkGameRecord>(RECORDS_KEY(userId), 0, limit - 1);
  return records ?? [];
}
