// src/lib/match3.ts - 消消乐（Match-3）后端逻辑

import { randomBytes } from 'crypto';
import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import { addGamePointsWithLimit } from './points';
import { getTodayDateString } from './time';
import { getDailyPointsLimit } from './config';
import { incrementSharedDailyStats } from './daily-stats';
import { MATCH3_DEFAULT_CONFIG, simulateMatch3Game } from './match3-engine';
import type { DailyGameStats, GameSessionStatus } from './types/game';
import type { Match3Config, Match3Move } from './match3-engine';

const GAME_TYPE = 'match3' as const;

const TIME_LIMIT_MS = 60 * 1000;
const SESSION_TTL = 2 * 60; // 2分钟：60s对局 + 提交缓冲
const COOLDOWN_TTL = 5; // 5秒
const MIN_GAME_DURATION = 10_000; // 10秒
const MAX_RECORD_ENTRIES = 50;
const MAX_MOVES_PER_GAME = 250;

// Key 格式
const SESSION_KEY = (sessionId: string) => `match3:session:${sessionId}`;
const ACTIVE_SESSION_KEY = (userId: number) => `match3:active:${userId}`;
const DAILY_STATS_KEY = (userId: number, date: string) => `game:daily:${userId}:${date}`;
const RECORDS_KEY = (userId: number) => `match3:records:${userId}`;
const COOLDOWN_KEY = (userId: number) => `match3:cooldown:${userId}`;
const SUBMIT_LOCK_KEY = (sessionId: string) => `match3:submit:${sessionId}`;

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
  const cooldown = await kv.get(COOLDOWN_KEY(userId));
  return cooldown !== null;
}

export async function getCooldownRemaining(userId: number): Promise<number> {
  const ttl = await kv.ttl(COOLDOWN_KEY(userId));
  return ttl > 0 ? ttl : 0;
}

export async function getDailyStats(userId: number): Promise<DailyGameStats> {
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

export async function getMatch3Records(userId: number, limit: number = 20): Promise<Match3GameRecord[]> {
  const records = await kv.lrange<Match3GameRecord>(RECORDS_KEY(userId), 0, limit - 1);
  return records ?? [];
}

export async function getActiveMatch3Session(userId: number): Promise<Match3GameSession | null> {
  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) return null;

  const session = await kv.get<Match3GameSession>(SESSION_KEY(activeSessionId));
  if (!session) {
    await kv.del(ACTIVE_SESSION_KEY(userId));
    return null;
  }
  return session;
}

export async function startMatch3Game(
  userId: number,
  config?: Partial<Match3Config>
): Promise<{ success: boolean; session?: Match3GameSession; message?: string }> {
  if (await isInCooldown(userId)) {
    const remaining = await getCooldownRemaining(userId);
    return { success: false, message: `请等待 ${remaining} 秒后再开始游戏` };
  }

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

  await kv.set(SESSION_KEY(session.id), session, { ex: SESSION_TTL });
  await kv.set(ACTIVE_SESSION_KEY(userId), session.id, { ex: SESSION_TTL });

  return { success: true, session };
}

export async function cancelMatch3Game(userId: number): Promise<{ success: boolean; message?: string }> {
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

export async function submitMatch3Result(
  userId: number,
  payload: Match3GameResultSubmit
): Promise<{ success: boolean; record?: Match3GameRecord; pointsEarned?: number; message?: string }> {
  const payloadCheck = validateSubmitPayload(payload);
  if (!payloadCheck.ok) return { success: false, message: payloadCheck.message };

  const lockKey = SUBMIT_LOCK_KEY(payload.sessionId);
  const lockAcquired = await kv.set(lockKey, '1', { ex: SESSION_TTL, nx: true });
  if (!lockAcquired) {
    return { success: false, message: '请勿重复提交' };
  }

  const session = await kv.get<Match3GameSession>(SESSION_KEY(payload.sessionId));
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
    await kv.del(SESSION_KEY(payload.sessionId));
    await kv.del(lockKey);
    return { success: false, message: '游戏会话已过期' };
  }

  const serverDuration = Date.now() - session.startedAt;
  if (serverDuration < MIN_GAME_DURATION) {
    await kv.del(lockKey);
    return { success: false, message: '游戏时长过短' };
  }

  // 服务端复算
  const sim = simulateMatch3Game(session.seed, session.config, payload.moves, { maxMoves: MAX_MOVES_PER_GAME });
  if (!sim.ok) {
    await kv.del(lockKey);
    return { success: false, message: sim.message };
  }

  const score = sim.score;
  const dailyPointsLimit = await getDailyPointsLimit();

  const pointsResult = await addGamePointsWithLimit(
    userId,
    score,
    dailyPointsLimit,
    'game_play',
    `消消乐得分 ${score}`
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

  await kv.del(SESSION_KEY(payload.sessionId));
  await kv.del(ACTIVE_SESSION_KEY(userId));
  await kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL });
  await incrementSharedDailyStats(userId, score, pointsResult.dailyEarned);

  await kv.lpush(RECORDS_KEY(userId), record);
  await kv.ltrim(RECORDS_KEY(userId), 0, MAX_RECORD_ENTRIES - 1);

  return { success: true, record, pointsEarned: pointsResult.pointsEarned };
}


