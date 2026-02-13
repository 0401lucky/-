// src/lib/tower.ts - 爬塔游戏后端逻辑

import { randomBytes } from 'crypto';
import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import { addGamePointsWithLimit } from './points';
import { getTodayDateString } from './time';
import { getDailyPointsLimit } from './config';
import { incrementSharedDailyStats } from './daily-stats';
import { simulateTowerGame, calculateTowerScore } from './tower-engine';
import type { TowerDifficulty } from './tower-engine';
import type { DailyGameStats, GameSessionStatus } from './types/game';

const GAME_TYPE = 'tower' as const;

const SESSION_TTL = 30 * 60; // 30分钟：回合制无实时压力，给予充足时间
const COOLDOWN_TTL = 5; // 5秒
const MIN_GAME_DURATION = 5_000; // 5秒
const MAX_RECORD_ENTRIES = 50;
const MAX_CHOICES = 500;

const VALID_DIFFICULTIES: TowerDifficulty[] = ['normal', 'hard', 'hell'];

// Key 格式
const SESSION_KEY = (sessionId: string) => `tower:session:${sessionId}`;
const ACTIVE_SESSION_KEY = (userId: number) => `tower:active:${userId}`;
const DAILY_STATS_KEY = (userId: number, date: string) => `game:daily:${userId}:${date}`;
const RECORDS_KEY = (userId: number) => `tower:records:${userId}`;
const COOLDOWN_KEY = (userId: number) => `tower:cooldown:${userId}`;
const SUBMIT_LOCK_KEY = (sessionId: string) => `tower:submit:${sessionId}`;

export interface TowerGameSession {
  id: string;
  userId: number;
  gameType: typeof GAME_TYPE;
  seed: string;
  startedAt: number;
  expiresAt: number;
  status: GameSessionStatus;
  difficulty?: TowerDifficulty;
}

export interface TowerGameRecord {
  id: string;
  userId: number;
  sessionId: string;
  gameType: typeof GAME_TYPE;
  floorsClimbed: number;
  finalPower: number;
  gameOver: boolean;
  score: number;
  basePoints: number;
  bossPoints: number;
  comboPoints: number;
  perfectPoints: number;
  bossesDefeated: number;
  maxCombo: number;
  pointsEarned: number;
  duration: number;
  createdAt: number;
  difficulty?: TowerDifficulty;
  difficultyMultiplier?: number;
}

export interface TowerGameResultSubmit {
  sessionId: string;
  choices: number[];
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

export async function getTowerRecords(userId: number, limit: number = 20): Promise<TowerGameRecord[]> {
  const records = await kv.lrange<TowerGameRecord>(RECORDS_KEY(userId), 0, limit - 1);
  return records ?? [];
}

export async function getActiveTowerSession(userId: number): Promise<TowerGameSession | null> {
  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) return null;

  const session = await kv.get<TowerGameSession>(SESSION_KEY(activeSessionId));
  if (!session) {
    await kv.del(ACTIVE_SESSION_KEY(userId));
    return null;
  }
  return session;
}

export async function startTowerGame(
  userId: number,
  difficulty?: TowerDifficulty,
): Promise<{ success: boolean; session?: TowerGameSession; message?: string }> {
  if (await isInCooldown(userId)) {
    const remaining = await getCooldownRemaining(userId);
    return { success: false, message: `请等待 ${remaining} 秒后再开始游戏` };
  }

  // 校验难度参数
  if (difficulty !== undefined && !VALID_DIFFICULTIES.includes(difficulty)) {
    return { success: false, message: '无效的难度选择' };
  }

  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (activeSessionId) {
    const activeSession = await kv.get<TowerGameSession>(SESSION_KEY(activeSessionId));
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
  const session: TowerGameSession = {
    id: nanoid(),
    userId,
    gameType: GAME_TYPE,
    seed: generateSeed(),
    startedAt: now,
    expiresAt: now + SESSION_TTL * 1000,
    status: 'playing',
    ...(difficulty !== undefined ? { difficulty } : {}),
  };

  await kv.set(SESSION_KEY(session.id), session, { ex: SESSION_TTL });
  await kv.set(ACTIVE_SESSION_KEY(userId), session.id, { ex: SESSION_TTL });

  return { success: true, session };
}

export async function cancelTowerGame(userId: number): Promise<{ success: boolean; message?: string }> {
  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) return { success: false, message: '没有正在进行的游戏' };

  await kv.del(SESSION_KEY(activeSessionId));
  await kv.del(ACTIVE_SESSION_KEY(userId));
  await kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL });

  return { success: true };
}

function validateSubmitPayload(payload: TowerGameResultSubmit): { ok: true } | { ok: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '无效的提交数据' };
  }

  if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    return { ok: false, message: '无效的会话ID' };
  }

  if (!Array.isArray(payload.choices)) {
    return { ok: false, message: '无效的选择序列' };
  }

  if (payload.choices.length > MAX_CHOICES) {
    return { ok: false, message: '选择步数过多' };
  }

  for (const choice of payload.choices) {
    if (!Number.isInteger(choice) || choice < 0) {
      return { ok: false, message: '选择索引必须为非负整数' };
    }
  }

  return { ok: true };
}

export async function submitTowerResult(
  userId: number,
  payload: TowerGameResultSubmit
): Promise<{ success: boolean; record?: TowerGameRecord; pointsEarned?: number; message?: string }> {
  const payloadCheck = validateSubmitPayload(payload);
  if (!payloadCheck.ok) return { success: false, message: payloadCheck.message };

  const lockKey = SUBMIT_LOCK_KEY(payload.sessionId);
  const lockAcquired = await kv.set(lockKey, '1', { ex: SESSION_TTL, nx: true });
  if (!lockAcquired) {
    return { success: false, message: '请勿重复提交' };
  }

  const session = await kv.get<TowerGameSession>(SESSION_KEY(payload.sessionId));
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

  const serverDuration = Date.now() - session.startedAt;
  if (serverDuration < MIN_GAME_DURATION) {
    await kv.del(lockKey);
    return { success: false, message: '游戏时长过短' };
  }

  // 向后兼容：旧 session 无 difficulty 字段
  const difficulty = session.difficulty ?? undefined;

  // 服务端重放验证
  const sim = simulateTowerGame(session.seed, payload.choices, difficulty);
  if (!sim.ok) {
    await kv.del(lockKey);
    return { success: false, message: sim.message };
  }

  const scoreBreakdown = calculateTowerScore(
    sim.floorsClimbed,
    sim.bossesDefeated,
    sim.maxCombo,
    sim.usedShield,
    difficulty,
  );
  const score = scoreBreakdown.total;
  const dailyPointsLimit = await getDailyPointsLimit();

  const diffLabel = difficulty ? ` [${difficulty}]` : '';
  const pointsResult = await addGamePointsWithLimit(
    userId,
    score,
    dailyPointsLimit,
    'game_play',
    `爬塔挑战${diffLabel} ${sim.floorsClimbed}层 Boss×${sim.bossesDefeated} Combo×${sim.maxCombo} 得分 ${score}`
  );

  const record: TowerGameRecord = {
    id: nanoid(),
    userId,
    sessionId: payload.sessionId,
    gameType: GAME_TYPE,
    floorsClimbed: sim.floorsClimbed,
    finalPower: sim.finalPower,
    gameOver: sim.gameOver,
    score,
    basePoints: scoreBreakdown.basePoints,
    bossPoints: scoreBreakdown.bossPoints,
    comboPoints: scoreBreakdown.comboPoints,
    perfectPoints: scoreBreakdown.perfectPoints,
    bossesDefeated: sim.bossesDefeated,
    maxCombo: sim.maxCombo,
    pointsEarned: pointsResult.pointsEarned,
    duration: serverDuration,
    createdAt: Date.now(),
    ...(difficulty !== undefined ? {
      difficulty,
      difficultyMultiplier: scoreBreakdown.difficultyMultiplier,
    } : {}),
  };

  await kv.del(SESSION_KEY(payload.sessionId));
  await kv.del(ACTIVE_SESSION_KEY(userId));
  await kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL });
  await incrementSharedDailyStats(userId, score, pointsResult.dailyEarned);

  await kv.lpush(RECORDS_KEY(userId), record);
  await kv.ltrim(RECORDS_KEY(userId), 0, MAX_RECORD_ENTRIES - 1);

  return { success: true, record, pointsEarned: pointsResult.pointsEarned };
}
