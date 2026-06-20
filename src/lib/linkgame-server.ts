// src/lib/linkgame-server.ts - 连连看游戏后端逻辑

import { randomBytes } from 'crypto';
import { kv } from '@/lib/d1-kv';
import { nanoid } from 'nanoid';
import { addGamePointsWithLimit } from './points';
import { getDailyPointsLimit } from './config';
import { getDailyStats, incrementSharedDailyStats } from './daily-stats';
import {
  cancelNativeGameSession,
  completeNativeGameSettlement,
  createNativeGameSession,
  getNativeActiveGameSession,
  getNativeGameCooldownRemaining,
  getNativeGameSession,
  isNativeHotStoreReady,
  listNativeGameRecords,
} from './hot-d1';
import { acquireGameLock, releaseGameLock } from './game-locks';
export { getDailyStats };
import {
  generateTileLayout,
  LINKGAME_DIFFICULTY_CONFIG,
  canMatchByConfig,
  removeMatchByConfig,
  checkGameComplete,
  calculateScore,
  calculateLinkGamePointReward,
  findHintByConfig,
  getLinkGameSettlementResult,
  getTileAt,
  indexOfPosition,
  isActivePosition,
} from './linkgame';
import type {
  LinkGameDifficulty,
  LinkGameSession,
  LinkGameResultSubmit,
  LinkGameRecord,
  LinkGamePosition,
  LinkGameDifficultyConfig,
  LinkGameSettlementOutcome,
} from './types/game';

// ============ 常量配置 ============

export const LINKGAME_SESSION_SETTLEMENT_GRACE_SECONDS = 60;
export const LINKGAME_SESSION_TTL_SECONDS =
  Math.max(...Object.values(LINKGAME_DIFFICULTY_CONFIG).map((config) => config.timeLimit)) +
  LINKGAME_SESSION_SETTLEMENT_GRACE_SECONDS;
const SESSION_TTL = LINKGAME_SESSION_TTL_SECONDS; // 游戏时限 + 结算缓冲
const COOLDOWN_TTL = 5; // 5秒
const MIN_GAME_DURATION = 5000; // 5秒
const MAX_RECORD_ENTRIES = 50;
const START_LOCK_TTL = 3;
const SUBMIT_LOCK_TTL = 20;

// Key 格式
const SESSION_KEY = (sessionId: string) => `linkgame:session:${sessionId}`;
const ACTIVE_SESSION_KEY = (userId: number) => `linkgame:active:${userId}`;
const RECORDS_KEY = (userId: number) => `linkgame:records:${userId}`;
const COOLDOWN_KEY = (userId: number) => `linkgame:cooldown:${userId}`;
const SUBMIT_LOCK_KEY = (sessionId: string) => `linkgame:submit:${sessionId}`;
const START_LOCK_KEY = (userId: number) => `linkgame:start:${userId}`;

// ============ 工具函数 ============

export function getLinkGamePlayableUntil(session: LinkGameSession): number {
  const config = LINKGAME_DIFFICULTY_CONFIG[session.difficulty];
  return session.startedAt + config.timeLimit * 1000;
}

export function getLinkGameRemainingSeconds(session: LinkGameSession, now: number = Date.now()): number {
  const config = LINKGAME_DIFFICULTY_CONFIG[session.difficulty];
  const remaining = Math.ceil((getLinkGamePlayableUntil(session) - now) / 1000);
  return Math.max(0, Math.min(config.timeLimit, remaining));
}

export function validateLinkGameSettlementTiming(
  serverDurationMs: number,
  config: LinkGameDifficultyConfig,
  outcome: LinkGameSettlementOutcome
): { ok: true } | { ok: false; message: string } {
  if (serverDurationMs < MIN_GAME_DURATION) {
    return { ok: false, message: '游戏时长过短' };
  }

  const timeLimitMs = config.timeLimit * 1000;
  if (outcome === 'timeout' && serverDurationMs < timeLimitMs) {
    return { ok: false, message: '游戏尚未超时' };
  }
  if (outcome === 'completed' && serverDurationMs > timeLimitMs) {
    return { ok: false, message: '游戏已超时' };
  }

  return { ok: true };
}

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
  if (await isNativeHotStoreReady()) {
    return (await getNativeGameCooldownRemaining(userId, 'linkgame')) > 0;
  }
  const cooldown = await kv.get(COOLDOWN_KEY(userId));
  return cooldown !== null;
}

/**
 * 获取冷却剩余时间（秒）
 */
export async function getCooldownRemaining(userId: number): Promise<number> {
  if (await isNativeHotStoreReady()) {
    return getNativeGameCooldownRemaining(userId, 'linkgame');
  }
  const ttl = await kv.ttl(COOLDOWN_KEY(userId));
  return ttl > 0 ? ttl : 0;
}

async function isCurrentActiveSession(
  userId: number,
  sessionId: string,
  useNativeHotStore: boolean,
): Promise<boolean> {
  if (useNativeHotStore) {
    const activeSession = await getNativeActiveGameSession<LinkGameSession>(userId, 'linkgame');
    return activeSession?.id === sessionId;
  }

  return (await kv.get<string>(ACTIVE_SESSION_KEY(userId))) === sessionId;
}

async function findSettledLinkGameRecord(
  userId: number,
  sessionId: string,
  useNativeHotStore: boolean,
): Promise<LinkGameRecord | null> {
  const records = useNativeHotStore
    ? await listNativeGameRecords<LinkGameRecord>(userId, 'linkgame', MAX_RECORD_ENTRIES)
    : ((await kv.lrange<LinkGameRecord>(RECORDS_KEY(userId), 0, MAX_RECORD_ENTRIES - 1)) ?? []);

  return records.find((record) => record.sessionId === sessionId) ?? null;
}

function buildSettledLinkGameResult(record: LinkGameRecord) {
  return { success: true as const, record, pointsEarned: record.pointsEarned };
}

// ============ 纯验证函数（可单独测试） ============

export interface ValidationResult {
  ok: boolean;
  message?: string;
  matchedPairs?: number;
  maxStreak?: number;
  completed?: boolean;
  deadlocked?: boolean;
  outcome?: LinkGameSettlementOutcome;
}

const LINKGAME_SETTLEMENT_OUTCOMES = new Set<LinkGameSettlementOutcome>([
  'completed',
  'deadlock',
  'timeout',
]);

/**
 * 验证连连看游戏结果（纯函数，无KV依赖）
 * 通过重放操作序列验证结果的合法性
 */
export function validateLinkGameResult(
  session: LinkGameSession,
  payload: LinkGameResultSubmit
): ValidationResult {
  const config = LINKGAME_DIFFICULTY_CONFIG[session.difficulty];

  // 基础类型检查
  if (!Array.isArray(payload.moves)) {
    return { ok: false, message: '无效的操作数据' };
  }

  if (typeof payload.completed !== 'boolean') {
    return { ok: false, message: '无效的完成状态' };
  }

  const requestedOutcome = payload.outcome ?? (payload.completed ? 'completed' : 'timeout');
  if (!LINKGAME_SETTLEMENT_OUTCOMES.has(requestedOutcome)) {
    return { ok: false, message: '无效的结算类型' };
  }

  // 重放验证
  let board: (string | null)[] = [...session.tileLayout];
  let matchedPairs = 0;
  let currentStreak = 0;
  let maxStreak = 0;

  for (const move of payload.moves) {
    // 类型检查
    if (!move || typeof move !== 'object') {
      return { ok: false, message: '无效的操作格式' };
    }

    const moveType = (move as { type?: string }).type;
    if (moveType === 'hint' || moveType === 'shuffle') {
      return { ok: false, message: '道具已移除' };
    }
    if (moveType && moveType !== 'match') {
      return { ok: false, message: '无效的操作类型' };
    }

    // Handle match moves (including legacy format without type field)
    const matchMove = move as { pos1?: LinkGamePosition; pos2?: LinkGamePosition; pos3?: LinkGamePosition; matched?: boolean; isTriple?: boolean };
    const { pos1, pos2, pos3, matched } = matchMove;

    // 位置类型检查
    if (!pos1 || !pos2 || typeof pos1 !== 'object' || typeof pos2 !== 'object') {
      return { ok: false, message: '无效的位置数据' };
    }

    if (!Number.isInteger(pos1.row) || !Number.isInteger(pos1.col) ||
        !Number.isInteger(pos2.row) || !Number.isInteger(pos2.col) ||
        (pos1.z !== undefined && !Number.isInteger(pos1.z)) ||
        (pos2.z !== undefined && !Number.isInteger(pos2.z))) {
      return { ok: false, message: '位置坐标必须为整数' };
    }

    if (typeof matched !== 'boolean') {
      return { ok: false, message: '无效的匹配标记' };
    }

    // 边界检查
    if (!isActivePosition(config, pos1)) {
      return { ok: false, message: '位置1超出边界' };
    }
    if (!isActivePosition(config, pos2)) {
      return { ok: false, message: '位置2超出边界' };
    }

    // 不能选同一个位置
    const idx1 = indexOfPosition(pos1, config);
    const idx2 = indexOfPosition(pos2, config);
    if (idx1 === idx2) {
      return { ok: false, message: '不能选择同一个位置' };
    }

    // 检查两个位置是否有瓦片
    if (getTileAt(board, pos1, config) === null) {
      return { ok: false, message: '位置1没有瓦片' };
    }
    if (getTileAt(board, pos2, config) === null) {
      return { ok: false, message: '位置2没有瓦片' };
    }

    if (pos3 && typeof pos3 === 'object') {
      return { ok: false, message: '三连模式已停用' };
    } else {
      const serverCanMatch = canMatchByConfig(board, pos1, pos2, config);
      if (matched !== serverCanMatch) {
        return { ok: false, message: '匹配结果不一致' };
      }

      if (matched) {
        board = removeMatchByConfig(board, pos1, pos2, config);
        matchedPairs++;
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
  }

  // 验证完成状态与死局状态
  const actuallyCompleted = checkGameComplete(board);
  const actuallyDeadlocked = !actuallyCompleted && findHintByConfig(board, config) === null;

  if (requestedOutcome === 'completed') {
    if (!payload.completed || !actuallyCompleted) {
      return { ok: false, message: '完成状态不一致' };
    }
  } else if (requestedOutcome === 'deadlock') {
    if (session.difficulty !== 'hard') {
      return { ok: false, message: '只有困难模式支持死局结算' };
    }
    if (payload.completed || actuallyCompleted) {
      return { ok: false, message: '死局状态不一致' };
    }
    if (!actuallyDeadlocked) {
      return { ok: false, message: '当前牌面仍有可消除的牌' };
    }
  } else if (payload.completed || actuallyCompleted) {
    return { ok: false, message: '完成状态不一致' };
  }

  return {
    ok: true,
    matchedPairs,
    maxStreak,
    completed: actuallyCompleted,
    deadlocked: actuallyDeadlocked,
    outcome: requestedOutcome,
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
  const useNativeHotStore = await isNativeHotStoreReady();
  const startLockKey = START_LOCK_KEY(userId);
  const startLockToken = await acquireGameLock(startLockKey, START_LOCK_TTL, useNativeHotStore);
  if (!startLockToken) {
    return { success: false, message: '操作过于频繁，请稍后再试' };
  }

  try {
  // 检查冷却
  if (await isInCooldown(userId)) {
    const remaining = await getCooldownRemaining(userId);
    return {
      success: false,
      message: `请等待 ${remaining} 秒后再开始游戏`,
    };
  }

  // 检查是否有未完成的会话
  if (useNativeHotStore) {
    const activeSession = await getNativeActiveGameSession<LinkGameSession>(userId, 'linkgame');
    if (activeSession?.status === 'playing' && Date.now() < activeSession.expiresAt) {
      return {
        success: false,
        message: '你已有正在进行的游戏',
      };
    }
  } else {
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

  if (useNativeHotStore) {
    await createNativeGameSession(session);
  } else {
    // 保存会话
    await kv.set(SESSION_KEY(session.id), session, { ex: SESSION_TTL });
    await kv.set(ACTIVE_SESSION_KEY(userId), session.id, { ex: SESSION_TTL });
  }

  return { success: true, session };
  } finally {
    await releaseGameLock(startLockKey, startLockToken, useNativeHotStore);
  }
}

/**
 * 获取当前活跃会话
 */
export async function getActiveLinkGameSession(userId: number): Promise<LinkGameSession | null> {
  if (await isNativeHotStoreReady()) {
    return getNativeActiveGameSession<LinkGameSession>(userId, 'linkgame');
  }

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
  if (await isNativeHotStoreReady()) {
    const cancelled = await cancelNativeGameSession(userId, 'linkgame', COOLDOWN_TTL);
    return cancelled ? { success: true } : { success: false, message: '没有正在进行的游戏' };
  }

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
  const useNativeHotStore = await isNativeHotStoreReady();
  const settledBeforeLock = await findSettledLinkGameRecord(userId, payload.sessionId, useNativeHotStore);
  if (settledBeforeLock) {
    return buildSettledLinkGameResult(settledBeforeLock);
  }

  // 幂等锁
  const lockKey = SUBMIT_LOCK_KEY(payload.sessionId);
  const lockToken = await acquireGameLock(lockKey, SUBMIT_LOCK_TTL, useNativeHotStore);
  if (!lockToken) {
    const settledWhileLocked = await findSettledLinkGameRecord(userId, payload.sessionId, useNativeHotStore);
    if (settledWhileLocked) {
      return buildSettledLinkGameResult(settledWhileLocked);
    }
    return { success: false, message: '请勿重复提交' };
  }

  const releaseLock = async () => {
    await releaseGameLock(lockKey, lockToken, useNativeHotStore);
  };

  // 获取会话
  const session = useNativeHotStore
    ? await getNativeGameSession<LinkGameSession>(payload.sessionId)
    : await kv.get<LinkGameSession>(SESSION_KEY(payload.sessionId));

  if (!session) {
    const settledRecord = await findSettledLinkGameRecord(userId, payload.sessionId, useNativeHotStore);
    if (settledRecord) {
      await releaseLock();
      return buildSettledLinkGameResult(settledRecord);
    }
    await releaseLock();
    return { success: false, message: '游戏会话不存在或已过期' };
  }

  if (session.userId !== userId) {
    await releaseLock();
    return { success: false, message: '会话不属于该用户' };
  }

  if (!await isCurrentActiveSession(userId, session.id, useNativeHotStore)) {
    const settledRecord = await findSettledLinkGameRecord(userId, session.id, useNativeHotStore);
    if (settledRecord) {
      await releaseLock();
      return buildSettledLinkGameResult(settledRecord);
    }
    await releaseLock();
    return { success: false, message: '游戏会话已不是当前活跃局' };
  }

  if (session.status !== 'playing') {
    const settledRecord = await findSettledLinkGameRecord(userId, session.id, useNativeHotStore);
    if (settledRecord) {
      await releaseLock();
      return buildSettledLinkGameResult(settledRecord);
    }
    await releaseLock();
    return { success: false, message: '游戏会话已结束' };
  }

  if (Date.now() > session.expiresAt) {
    const settledRecord = await findSettledLinkGameRecord(userId, session.id, useNativeHotStore);
    if (settledRecord) {
      await releaseLock();
      return buildSettledLinkGameResult(settledRecord);
    }
    if (!useNativeHotStore) {
      await kv.del(SESSION_KEY(payload.sessionId));
    }
    await releaseLock();
    return { success: false, message: '游戏会话已过期' };
  }

  // 验证结果
  const validation = validateLinkGameResult(session, payload);
  if (!validation.ok) {
    await releaseLock();
    return { success: false, message: validation.message };
  }

  // 服务端时长校验
  const serverDuration = Date.now() - session.startedAt;
  const settlementOutcome = validation.outcome ?? (validation.completed ? 'completed' : 'timeout');
  const config = LINKGAME_DIFFICULTY_CONFIG[session.difficulty];
  const timingValidation = validateLinkGameSettlementTiming(serverDuration, config, settlementOutcome);
  if (!timingValidation.ok) {
    await releaseLock();
    return { success: false, message: timingValidation.message };
  }

  // 计算得分（服务端计算，不信任客户端）
  let score = 0;

  const shouldCalculateScore =
    validation.completed ||
    settlementOutcome === 'deadlock' ||
    (session.difficulty === 'hard' && settlementOutcome === 'timeout');

  if (shouldCalculateScore) {
    // 困难模式采用层数压力计分，不再吃连击加成。
    const combo = session.difficulty === 'hard'
      ? 0
      : Math.max(0, (validation.maxStreak ?? 0) - 1);
    const timeRemainingSeconds = Math.max(0, config.timeLimit - Math.floor(serverDuration / 1000));

    score = calculateScore({
      matchedPairs: validation.matchedPairs ?? 0,
      baseScore: config.baseScore,
      combo,
      timeRemainingSeconds,
      difficulty: session.difficulty,
      totalPairs: config.pairs,
      outcome: settlementOutcome,
    });
  }
  const pointReward = calculateLinkGamePointReward(score, session.difficulty, settlementOutcome);
  // 获取动态配置的每日积分上限
  const dailyPointsLimit = await getDailyPointsLimit();

  // 使用原子化积分发放
  const pointsResult = await addGamePointsWithLimit(
    userId,
    pointReward,
    dailyPointsLimit,
    'game_play',
    `连连看${settlementOutcome === 'deadlock' ? '死局' : settlementOutcome === 'completed' ? '通关' : '超时'}得分 ${score}，福利积分 ${pointReward}`
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
    outcome: settlementOutcome,
    settlementResult: getLinkGameSettlementResult(validation.completed ?? false, settlementOutcome),
    score,
    pointsEarned,
    duration: serverDuration,
    createdAt: Date.now(),
  };

  if (useNativeHotStore) {
    await incrementSharedDailyStats(userId, score, pointsResult.dailyEarned);
    await completeNativeGameSettlement(
      record,
      payload.sessionId,
      score,
      pointsResult.dailyEarned,
      COOLDOWN_TTL,
    );
  } else {
    // [Perf] 清理会话、冷却、统计并行执行
    await Promise.all([
      kv.del(SESSION_KEY(payload.sessionId)),
      kv.del(ACTIVE_SESSION_KEY(userId)),
      kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL }),
      incrementSharedDailyStats(userId, score, pointsResult.dailyEarned),
      kv.lpush(RECORDS_KEY(userId), record).then(() =>
        kv.ltrim(RECORDS_KEY(userId), 0, MAX_RECORD_ENTRIES - 1)
      ),
    ]);
  }

  return { success: true, record, pointsEarned };
}

/**
 * 获取用户游戏记录
 */
export async function getLinkGameRecords(
  userId: number,
  limit: number = 20
): Promise<LinkGameRecord[]> {
  if (await isNativeHotStoreReady()) {
    return listNativeGameRecords<LinkGameRecord>(userId, 'linkgame', limit);
  }

  const records = await kv.lrange<LinkGameRecord>(RECORDS_KEY(userId), 0, limit - 1);
  return records ?? [];
}
