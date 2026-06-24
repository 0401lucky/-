// src/lib/match3.ts - 消消乐（Match-3）后端逻辑

import { randomBytes } from 'crypto';
import { kv } from '@/lib/d1-kv';
import { nanoid } from 'nanoid';
import { addGamePointsWithLimit } from './points';
import { getDailyPointsLimit } from './config';
import { getDailyStats, incrementSharedDailyStats } from './daily-stats';
import {
  settleGameFallbackTransfer,
  type GameFallbackTransferFailure,
} from './game-fallback';
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
import { MATCH3_DEFAULT_CONFIG, simulateMatch3Game } from './match3-engine';
import type { GameSessionStatus } from './types/game';
import type { Match3Config, Match3Move } from './match3-engine';

const GAME_TYPE = 'match3' as const;

const TIME_LIMIT_MS = 60 * 1000;
const SESSION_TTL = 5 * 60; // 5分钟：60s对局 + 提交缓冲
const COOLDOWN_TTL = 5; // 5秒
const MIN_GAME_DURATION = 10_000; // 10秒
const MAX_RECORD_ENTRIES = 50;
const MAX_MOVES_PER_GAME = 250;
const START_LOCK_TTL = 3;
const SUBMIT_LOCK_TTL = 20;

// Key 格式
const SESSION_KEY = (sessionId: string) => `match3:session:${sessionId}`;
const ACTIVE_SESSION_KEY = (userId: number) => `match3:active:${userId}`;
const RECORDS_KEY = (userId: number) => `match3:records:${userId}`;
const COOLDOWN_KEY = (userId: number) => `match3:cooldown:${userId}`;
const SUBMIT_LOCK_KEY = (sessionId: string) => `match3:submit:${sessionId}`;
const START_LOCK_KEY = (userId: number) => `match3:start:${userId}`;

export interface Match3GameSession {
  id: string;
  userId: number;
  gameType: typeof GAME_TYPE;
  seed: string;
  config: Match3Config;
  timeLimitMs: number;
  startedAt: number;
  expiresAt: number;
  status: GameSessionStatus;
}

export interface Match3GameRecord {
  id: string;
  userId: number;
  sessionId: string;
  gameType: typeof GAME_TYPE;
  score: number;
  pointsEarned: number;
  moves: number;
  cascades: number;
  tilesCleared: number;
  duration: number;
  createdAt: number;
}

export interface Match3GameResultSubmit {
  sessionId: string;
  moves: Match3Move[];
}

function generateSeed(): string {
  return randomBytes(16).toString('hex');
}

export async function isInCooldown(userId: number): Promise<boolean> {
  if (await isNativeHotStoreReady()) {
    return (await getNativeGameCooldownRemaining(userId, 'match3')) > 0;
  }
  const cooldown = await kv.get(COOLDOWN_KEY(userId));
  return cooldown !== null;
}

export async function getCooldownRemaining(userId: number): Promise<number> {
  if (await isNativeHotStoreReady()) {
    return getNativeGameCooldownRemaining(userId, 'match3');
  }
  const ttl = await kv.ttl(COOLDOWN_KEY(userId));
  return ttl > 0 ? ttl : 0;
}

export async function getMatch3Records(userId: number, limit: number = 20): Promise<Match3GameRecord[]> {
  if (await isNativeHotStoreReady()) {
    return listNativeGameRecords<Match3GameRecord>(userId, 'match3', limit);
  }
  const records = await kv.lrange<Match3GameRecord>(RECORDS_KEY(userId), 0, limit - 1);
  return records ?? [];
}

async function findSettledMatch3Record(
  userId: number,
  sessionId: string,
  useNativeHotStore: boolean,
): Promise<Match3GameRecord | null> {
  const records = useNativeHotStore
    ? await listNativeGameRecords<Match3GameRecord>(userId, GAME_TYPE, MAX_RECORD_ENTRIES)
    : ((await kv.lrange<Match3GameRecord>(RECORDS_KEY(userId), 0, MAX_RECORD_ENTRIES - 1)) ?? []);

  return records.find((record) => record.sessionId === sessionId) ?? null;
}

function buildSettledMatch3Result(record: Match3GameRecord) {
  return { success: true as const, record, pointsEarned: record.pointsEarned };
}

export async function getActiveMatch3Session(userId: number): Promise<Match3GameSession | null> {
  if (await isNativeHotStoreReady()) {
    return getNativeActiveGameSession<Match3GameSession>(userId, 'match3');
  }
  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) return null;

  const session = await kv.get<Match3GameSession>(SESSION_KEY(activeSessionId));
  if (!session) {
    await kv.del(ACTIVE_SESSION_KEY(userId));
    return null;
  }
  return session;
}

async function isCurrentActiveSession(
  userId: number,
  sessionId: string,
  useNativeHotStore: boolean,
): Promise<boolean> {
  if (useNativeHotStore) {
    const activeSession = await getNativeActiveGameSession<Match3GameSession>(userId, 'match3');
    return activeSession?.id === sessionId;
  }

  return (await kv.get<string>(ACTIVE_SESSION_KEY(userId))) === sessionId;
}

export async function startMatch3Game(
  userId: number,
  config?: Partial<Match3Config>
): Promise<{ success: boolean; session?: Match3GameSession; message?: string }> {
  const useNativeHotStore = await isNativeHotStoreReady();
  const startLockKey = START_LOCK_KEY(userId);
  const startLockToken = await acquireGameLock(startLockKey, START_LOCK_TTL, useNativeHotStore);
  if (!startLockToken) {
    return { success: false, message: '操作过于频繁，请稍后再试' };
  }

  try {
  if (await isInCooldown(userId)) {
    const remaining = await getCooldownRemaining(userId);
    return { success: false, message: `请等待 ${remaining} 秒后再开始游戏` };
  }

  if (useNativeHotStore) {
    const activeSession = await getNativeActiveGameSession<Match3GameSession>(userId, 'match3');
    if (activeSession?.status === 'playing' && Date.now() < activeSession.expiresAt) {
      return { success: false, message: '你已有正在进行的游戏' };
    }
  } else {
    const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
    if (activeSessionId) {
      const activeSession = await kv.get<Match3GameSession>(SESSION_KEY(activeSessionId));
      if (!activeSession) {
        await kv.del(ACTIVE_SESSION_KEY(userId));
      } else if (activeSession.status === 'playing' && Date.now() < activeSession.expiresAt) {
        return { success: false, message: '你已有正在进行的游戏' };
      } else {
        await kv.del(SESSION_KEY(activeSessionId));
        await kv.del(ACTIVE_SESSION_KEY(userId));
      }
    }
  }

  const now = Date.now();
  const session: Match3GameSession = {
    id: nanoid(),
    userId,
    gameType: GAME_TYPE,
    seed: generateSeed(),
    config: { ...MATCH3_DEFAULT_CONFIG, ...(config ?? {}) },
    timeLimitMs: TIME_LIMIT_MS,
    startedAt: now,
    expiresAt: now + SESSION_TTL * 1000,
    status: 'playing',
  };

  if (useNativeHotStore) {
    await createNativeGameSession(session);
  } else {
    await kv.set(SESSION_KEY(session.id), session, { ex: SESSION_TTL });
    await kv.set(ACTIVE_SESSION_KEY(userId), session.id, { ex: SESSION_TTL });
  }

  return { success: true, session };
  } finally {
    await releaseGameLock(startLockKey, startLockToken, useNativeHotStore);
  }
}

export async function cancelMatch3Game(userId: number): Promise<{ success: boolean; message?: string }> {
  if (await isNativeHotStoreReady()) {
    const cancelled = await cancelNativeGameSession(userId, 'match3', COOLDOWN_TTL);
    return cancelled ? { success: true } : { success: false, message: '没有正在进行的游戏' };
  }

  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) return { success: false, message: '没有正在进行的游戏' };

  await kv.del(SESSION_KEY(activeSessionId));
  await kv.del(ACTIVE_SESSION_KEY(userId));
  await kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL });

  return { success: true };
}

function validateSubmitPayload(payload: Match3GameResultSubmit): { ok: true } | { ok: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '无效的提交数据' };
  }

  if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    return { ok: false, message: '无效的会话ID' };
  }

  if (!Array.isArray(payload.moves)) {
    return { ok: false, message: '无效的操作序列' };
  }

  if (payload.moves.length > MAX_MOVES_PER_GAME) {
    return { ok: false, message: '操作步数过多' };
  }

  for (const move of payload.moves) {
    if (!move || typeof move !== 'object') return { ok: false, message: '操作数据格式错误' };
    if (!Number.isInteger(move.from) || !Number.isInteger(move.to)) {
      return { ok: false, message: '操作坐标必须为整数' };
    }
  }

  return { ok: true };
}

export function calculateMatch3PointReward(score: number): number {
  return Math.max(0, Math.floor(score / 10));
}

export async function submitMatch3Result(
  userId: number,
  payload: Match3GameResultSubmit
): Promise<{ success: boolean; record?: Match3GameRecord; pointsEarned?: number; message?: string }> {
  const useNativeHotStore = await isNativeHotStoreReady();
  const payloadCheck = validateSubmitPayload(payload);
  if (!payloadCheck.ok) return { success: false, message: payloadCheck.message };

  const lockKey = SUBMIT_LOCK_KEY(payload.sessionId);
  const lockToken = await acquireGameLock(lockKey, SUBMIT_LOCK_TTL, useNativeHotStore);
  if (!lockToken) {
    return { success: false, message: '请勿重复提交' };
  }

  const releaseLock = async () => {
    await releaseGameLock(lockKey, lockToken, useNativeHotStore);
  };

  const session = useNativeHotStore
    ? await getNativeGameSession<Match3GameSession>(payload.sessionId)
    : await kv.get<Match3GameSession>(SESSION_KEY(payload.sessionId));
  if (!session) {
    await releaseLock();
    return { success: false, message: '游戏会话不存在或已过期' };
  }
  if (session.userId !== userId) {
    await releaseLock();
    return { success: false, message: '会话不属于该用户' };
  }
  if (!await isCurrentActiveSession(userId, session.id, useNativeHotStore)) {
    await releaseLock();
    return { success: false, message: '游戏会话已不是当前活跃局' };
  }
  if (session.status !== 'playing') {
    await releaseLock();
    return { success: false, message: '游戏会话已结束' };
  }
  if (Date.now() > session.expiresAt) {
    if (!useNativeHotStore) {
      await kv.del(SESSION_KEY(payload.sessionId));
    }
    await releaseLock();
    return { success: false, message: '游戏会话已过期' };
  }

  const serverDuration = Date.now() - session.startedAt;
  if (serverDuration < MIN_GAME_DURATION) {
    await releaseLock();
    return { success: false, message: '游戏时长过短' };
  }

  // 服务端复算
  const sim = simulateMatch3Game(session.seed, session.config, payload.moves, { maxMoves: MAX_MOVES_PER_GAME });
  if (!sim.ok) {
    await releaseLock();
    return { success: false, message: sim.message };
  }

  const score = sim.score;
  const pointReward = calculateMatch3PointReward(score);
  const dailyPointsLimit = await getDailyPointsLimit();

  const pointsResult = await addGamePointsWithLimit(
    userId,
    pointReward,
    dailyPointsLimit,
    'game_play',
    `消消乐得分 ${score}，福利积分 ${pointReward}`
  );

  const record: Match3GameRecord = {
    id: nanoid(),
    userId,
    sessionId: payload.sessionId,
    gameType: GAME_TYPE,
    score,
    pointsEarned: pointsResult.pointsEarned,
    moves: sim.stats.movesApplied,
    cascades: sim.stats.cascades,
    tilesCleared: sim.stats.tilesCleared,
    duration: Math.min(serverDuration, TIME_LIMIT_MS),
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

  return { success: true, record, pointsEarned: pointsResult.pointsEarned };
}

export async function settleMatch3Fallback(
  userId: number,
  payload: Match3GameResultSubmit,
): Promise<{
  success: boolean;
  record?: Match3GameRecord;
  pointsEarned?: number;
  message?: string;
  adminInsufficient?: boolean;
}> {
  const payloadCheck = validateSubmitPayload(payload);
  if (!payloadCheck.ok) return { success: false, message: payloadCheck.message };

  const useNativeHotStore = await isNativeHotStoreReady();
  const settledBeforeLock = await findSettledMatch3Record(userId, payload.sessionId, useNativeHotStore);
  if (settledBeforeLock) {
    return buildSettledMatch3Result(settledBeforeLock);
  }

  const lockKey = SUBMIT_LOCK_KEY(payload.sessionId);
  const lockToken = await acquireGameLock(lockKey, SUBMIT_LOCK_TTL, useNativeHotStore);
  if (!lockToken) {
    const settledWhileLocked = await findSettledMatch3Record(userId, payload.sessionId, useNativeHotStore);
    if (settledWhileLocked) {
      return buildSettledMatch3Result(settledWhileLocked);
    }
    return { success: false, message: '兜底结算正在处理，请稍后重试' };
  }

  try {
    const session = useNativeHotStore
      ? await getNativeGameSession<Match3GameSession>(payload.sessionId)
      : await kv.get<Match3GameSession>(SESSION_KEY(payload.sessionId));
    if (!session) {
      const settledRecord = await findSettledMatch3Record(userId, payload.sessionId, useNativeHotStore);
      if (settledRecord) {
        return buildSettledMatch3Result(settledRecord);
      }
      return { success: false, message: '游戏会话不存在或已过期' };
    }
    if (session.userId !== userId) {
      return { success: false, message: '会话不属于该用户' };
    }
    if (!await isCurrentActiveSession(userId, session.id, useNativeHotStore)) {
      const settledRecord = await findSettledMatch3Record(userId, session.id, useNativeHotStore);
      if (settledRecord) {
        return buildSettledMatch3Result(settledRecord);
      }
      return { success: false, message: '游戏会话已不是当前活跃局' };
    }
    if (session.status !== 'playing') {
      const settledRecord = await findSettledMatch3Record(userId, session.id, useNativeHotStore);
      if (settledRecord) {
        return buildSettledMatch3Result(settledRecord);
      }
      return { success: false, message: '游戏会话已结束' };
    }
    if (Date.now() > session.expiresAt) {
      return { success: false, message: '游戏会话已过期' };
    }

    const serverDuration = Date.now() - session.startedAt;
    if (serverDuration < MIN_GAME_DURATION) {
      return { success: false, message: '游戏时长过短' };
    }

    const sim = simulateMatch3Game(session.seed, session.config, payload.moves, { maxMoves: MAX_MOVES_PER_GAME });
    if (!sim.ok) {
      return { success: false, message: sim.message };
    }

    const score = sim.score;
    const pointReward = calculateMatch3PointReward(score);
    const transferResult = await settleGameFallbackTransfer({
      gameKey: 'match3',
      sessionId: session.id,
      userId,
      score,
      pointReward,
      gameName: '消消乐',
      resultLabel: '',
    });
    if (!transferResult.success) {
      return transferResult as GameFallbackTransferFailure;
    }

    const record: Match3GameRecord = {
      id: nanoid(),
      userId,
      sessionId: session.id,
      gameType: GAME_TYPE,
      score,
      pointsEarned: transferResult.pointsEarned,
      moves: sim.stats.movesApplied,
      cascades: sim.stats.cascades,
      tilesCleared: sim.stats.tilesCleared,
      duration: Math.min(serverDuration, TIME_LIMIT_MS),
      createdAt: Date.now(),
    };

    const currentStats = await getDailyStats(userId);
    const cumulativePointsEarned = currentStats.pointsEarned + transferResult.pointsEarned;
    if (useNativeHotStore) {
      await incrementSharedDailyStats(userId, score, cumulativePointsEarned);
      await completeNativeGameSettlement(
        record,
        session.id,
        score,
        cumulativePointsEarned,
        COOLDOWN_TTL,
      );
    } else {
      await incrementSharedDailyStats(userId, score, cumulativePointsEarned);
      await kv.lpush(RECORDS_KEY(userId), record);
      await kv.ltrim(RECORDS_KEY(userId), 0, MAX_RECORD_ENTRIES - 1);
      await Promise.all([
        kv.del(SESSION_KEY(session.id)),
        kv.del(ACTIVE_SESSION_KEY(userId)),
        kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL }),
      ]);
    }

    return { success: true, record, pointsEarned: transferResult.pointsEarned };
  } finally {
    await releaseGameLock(lockKey, lockToken, useNativeHotStore);
  }
}
