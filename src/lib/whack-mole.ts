import { randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { kv } from '@/lib/d1-kv';
import { addGamePointsWithLimit } from './points';
import { getDailyPointsLimit } from './config';
import { getDailyStats, incrementSharedDailyStats } from './daily-stats';
import {
  createEmptyWhackMoleBoard,
  getWhackMoleBoard,
  getWhackMoleRefreshMs,
  getWhackMoleTickIndex,
  WHACK_MOLE_GAME_DURATION_MS,
  WHACK_MOLE_HOLE_COUNT,
  WHACK_MOLE_MAX_EVENTS,
  WHACK_MOLE_MAX_EVENTS_PER_SECOND,
  calculateWhackMolePointReward,
  scoreWhackMoleEvents,
  type WhackMoleCell,
  type WhackMoleHitEvent,
  type WhackMoleHitResult,
  type WhackMoleScoreStats,
} from './whack-mole-engine';
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
import type { GameSessionStatus } from './types/game';

export { getDailyStats };

const GAME_TYPE = 'whack_mole' as const;
const SESSION_TTL = 90;
const COOLDOWN_TTL = 5;
const MAX_RECORD_ENTRIES = 50;
const START_LOCK_TTL = 3;
const HIT_LOCK_TTL = 2;
const HIT_GRACE_MAX_MS = 350;
const HIT_GRACE_STEP_MS = 20;
const HIT_CLIENT_LATENCY_MS = 1500;
const HIT_CLIENT_FUTURE_TOLERANCE_MS = 160;

export function getDynamicGraceMs(elapsedMs: number): number {
  const refreshMs = getWhackMoleRefreshMs(elapsedMs);
  const dynamic = Math.floor(refreshMs * 0.6);
  return Math.min(HIT_GRACE_MAX_MS, Math.max(HIT_GRACE_STEP_MS, dynamic));
}

const SESSION_KEY = (sessionId: string) => `whack_mole:session:${sessionId}`;
const ACTIVE_SESSION_KEY = (userId: number) => `whack_mole:active:${userId}`;
const RECORDS_KEY = (userId: number) => `whack_mole:records:${userId}`;
const COOLDOWN_KEY = (userId: number) => `whack_mole:cooldown:${userId}`;
const SUBMIT_LOCK_KEY = (sessionId: string) => `whack_mole:submit:${sessionId}`;
const HIT_LOCK_KEY = (sessionId: string) => `whack_mole:hit:${sessionId}`;
const START_LOCK_KEY = (userId: number) => `whack_mole:start:${userId}`;

export interface WhackMoleGameSession {
  id: string;
  userId: number;
  gameType: typeof GAME_TYPE;
  seed: string;
  startedAt: number;
  expiresAt: number;
  status: GameSessionStatus;
  events?: WhackMoleHitEvent[];
}

export interface WhackMoleGameRecord {
  id: string;
  userId: number;
  sessionId: string;
  gameType: typeof GAME_TYPE;
  score: number;
  pointsEarned: number;
  hits: number;
  goldenHits: number;
  misses: number;
  bombs: number;
  maxCombo: number;
  duration: number;
  createdAt: number;
}

export interface WhackMoleResultSubmit {
  sessionId: string;
  events?: WhackMoleHitEvent[];
}

export interface WhackMoleHitPayload {
  sessionId: string;
  index: number;
  clientElapsedMs?: number;
}

export interface WhackMoleSessionView {
  sessionId: string;
  seed: string;
  startedAt: number;
  expiresAt: number;
  durationMs: number;
  board: WhackMoleCell[];
  boardTick: number;
  timeLeftMs: number;
  score: number;
  combo: number;
  eventsCount: number;
}

export interface WhackMoleHitResponse extends WhackMoleSessionView {
  result: WhackMoleHitResult;
  scoreDelta: number;
  comboAfter: number;
}

function generateSeed(): string {
  return randomBytes(16).toString('hex');
}

function buildSession(userId: number): WhackMoleGameSession {
  const now = Date.now();
  return {
    id: nanoid(),
    userId,
    gameType: GAME_TYPE,
    seed: generateSeed(),
    startedAt: now,
    expiresAt: now + SESSION_TTL * 1000,
    status: 'playing',
    events: [],
  };
}

function normalizeEvents(events: unknown): WhackMoleHitEvent[] {
  if (!Array.isArray(events)) return [];
  return events
    .filter((event): event is { index: number; elapsedMs: number } =>
      Boolean(event)
      && typeof event === 'object'
      && typeof (event as { index?: unknown }).index === 'number'
      && typeof (event as { elapsedMs?: unknown }).elapsedMs === 'number',
    )
    .map((event) => ({
      index: Math.floor(event.index),
      elapsedMs: Math.floor(event.elapsedMs),
    }))
    .filter((event) =>
      Number.isInteger(event.index)
      && event.index >= 0
      && event.index < WHACK_MOLE_HOLE_COUNT
      && Number.isInteger(event.elapsedMs)
      && event.elapsedMs >= 0
      && event.elapsedMs < WHACK_MOLE_GAME_DURATION_MS
    )
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
}

function normalizeSession(raw: unknown): WhackMoleGameSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const session = raw as Partial<WhackMoleGameSession>;
  if (
    typeof session.id !== 'string'
    || typeof session.userId !== 'number'
    || session.gameType !== GAME_TYPE
    || typeof session.seed !== 'string'
    || typeof session.startedAt !== 'number'
    || typeof session.expiresAt !== 'number'
    || typeof session.status !== 'string'
  ) {
    return null;
  }

  return {
    id: session.id,
    userId: session.userId,
    gameType: GAME_TYPE,
    seed: session.seed,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    status: session.status as GameSessionStatus,
    events: normalizeEvents(session.events),
  };
}

function buildSessionView(session: WhackMoleGameSession, now: number = Date.now()): WhackMoleSessionView {
  const events = normalizeEvents(session.events);
  const elapsedMs = Math.max(0, now - session.startedAt);
  const boardElapsedMs = Math.min(elapsedMs, WHACK_MOLE_GAME_DURATION_MS - 1);
  const scored = scoreWhackMoleEvents(session.seed, events);

  return {
    sessionId: session.id,
    seed: session.seed,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    durationMs: WHACK_MOLE_GAME_DURATION_MS,
    board: elapsedMs >= WHACK_MOLE_GAME_DURATION_MS
      ? createEmptyWhackMoleBoard()
      : getWhackMoleBoard(session.seed, boardElapsedMs),
    boardTick: getWhackMoleTickIndex(boardElapsedMs),
    timeLeftMs: Math.max(0, WHACK_MOLE_GAME_DURATION_MS - elapsedMs),
    score: scored.score,
    combo: scored.combo,
    eventsCount: events.length,
  };
}

async function saveSession(session: WhackMoleGameSession, useNativeHotStore: boolean): Promise<void> {
  if (useNativeHotStore) {
    await createNativeGameSession(session);
    return;
  }

  const ttl = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));
  await kv.set(SESSION_KEY(session.id), session, { ex: ttl });
  await kv.set(ACTIVE_SESSION_KEY(session.userId), session.id, { ex: ttl });
}

async function loadSessionById(sessionId: string, useNativeHotStore: boolean): Promise<WhackMoleGameSession | null> {
  const raw = useNativeHotStore
    ? await getNativeGameSession<WhackMoleGameSession>(sessionId)
    : await kv.get<WhackMoleGameSession>(SESSION_KEY(sessionId));
  return normalizeSession(raw);
}

async function isCurrentActiveSession(
  userId: number,
  sessionId: string,
  useNativeHotStore: boolean,
): Promise<boolean> {
  if (useNativeHotStore) {
    const activeSession = await getNativeActiveGameSession<WhackMoleGameSession>(userId, GAME_TYPE);
    return activeSession?.id === sessionId;
  }

  return (await kv.get<string>(ACTIVE_SESSION_KEY(userId))) === sessionId;
}

export function buildWhackMoleSessionView(session: WhackMoleGameSession): WhackMoleSessionView {
  return buildSessionView(session);
}

function validateSubmitPayload(
  payload: WhackMoleResultSubmit,
): { ok: true } | { ok: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '无效的提交数据' };
  }

  if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    return { ok: false, message: '无效的会话ID' };
  }

  return { ok: true };
}

function validateEventsRate(events: WhackMoleHitEvent[]): { ok: true } | { ok: false; message: string } {
  if (events.length > WHACK_MOLE_MAX_EVENTS) {
    return { ok: false, message: '敲击次数异常' };
  }
  const buckets = new Map<number, number>();
  for (const event of events) {
    const second = Math.floor(event.elapsedMs / 1000);
    const count = (buckets.get(second) ?? 0) + 1;
    if (count > WHACK_MOLE_MAX_EVENTS_PER_SECOND) {
      return { ok: false, message: '敲击频率异常' };
    }
    buckets.set(second, count);
  }

  return { ok: true };
}

export function resolveHitWithGrace(
  seed: string,
  existingEvents: WhackMoleHitEvent[],
  index: number,
  serverElapsedMs: number,
  clientElapsedMs?: number,
) {
  const scoreAt = (hitElapsedMs: number) => {
    const hitEvent = { index, elapsedMs: hitElapsedMs };
    const events = [...existingEvents, hitEvent].sort((a, b) => a.elapsedMs - b.elapsedMs);
    const scored = scoreWhackMoleEvents(seed, events);
    const hitEventIndex = events.indexOf(hitEvent);
    return {
      events,
      scored,
      lastEvent: scored.events[hitEventIndex],
    };
  };

  const resolveAt = (elapsedMs: number) => {
    const current = scoreAt(elapsedMs);
    if (!current.lastEvent || current.lastEvent.result !== 'miss') {
      return current;
    }

    const graceMs = getDynamicGraceMs(elapsedMs);
    for (let offset = HIT_GRACE_STEP_MS; offset <= graceMs; offset += HIT_GRACE_STEP_MS) {
      const candidateElapsed = Math.max(0, elapsedMs - offset);
      const candidate = scoreAt(candidateElapsed);
      if (candidate.lastEvent && candidate.lastEvent.result !== 'miss') {
        return candidate;
      }
    }

    return current;
  };

  if (clientElapsedMs !== undefined) {
    const clientResolution = resolveAt(clientElapsedMs);
    if (clientResolution.lastEvent && clientResolution.lastEvent.result !== 'miss') {
      return clientResolution;
    }
  }

  return resolveAt(serverElapsedMs);
}

function validateHitPayload(
  payload: WhackMoleHitPayload,
): { ok: true; index: number; clientElapsedMs?: number } | { ok: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '无效的敲击数据' };
  }
  if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    return { ok: false, message: '无效的会话ID' };
  }
  if (!Number.isInteger(payload.index) || payload.index < 0 || payload.index >= WHACK_MOLE_HOLE_COUNT) {
    return { ok: false, message: '无效的洞位' };
  }

  const clientElapsedMs = typeof payload.clientElapsedMs === 'number' && Number.isFinite(payload.clientElapsedMs)
    ? Math.floor(payload.clientElapsedMs)
    : undefined;
  return { ok: true, index: payload.index, clientElapsedMs };
}

function normalizeClientHitElapsedMs(
  clientElapsedMs: number | undefined,
  serverElapsedMs: number,
): number | undefined {
  if (clientElapsedMs === undefined) return undefined;
  if (clientElapsedMs < 0 || clientElapsedMs >= WHACK_MOLE_GAME_DURATION_MS) return undefined;
  if (clientElapsedMs > serverElapsedMs + HIT_CLIENT_FUTURE_TOLERANCE_MS) return undefined;
  if (serverElapsedMs - clientElapsedMs > HIT_CLIENT_LATENCY_MS) return undefined;

  return clientElapsedMs;
}

async function clearLegacySession(sessionId: string, userId: number): Promise<void> {
  await Promise.all([
    kv.del(SESSION_KEY(sessionId)),
    kv.del(ACTIVE_SESSION_KEY(userId)),
  ]);
}

export async function isInWhackMoleCooldown(userId: number): Promise<boolean> {
  if (await isNativeHotStoreReady()) {
    return (await getNativeGameCooldownRemaining(userId, GAME_TYPE)) > 0;
  }
  return (await kv.get(COOLDOWN_KEY(userId))) !== null;
}

export async function getWhackMoleCooldownRemaining(userId: number): Promise<number> {
  if (await isNativeHotStoreReady()) {
    return getNativeGameCooldownRemaining(userId, GAME_TYPE);
  }
  const ttl = await kv.ttl(COOLDOWN_KEY(userId));
  return ttl > 0 ? ttl : 0;
}

export async function getWhackMoleRecords(
  userId: number,
  limit: number = 20,
): Promise<WhackMoleGameRecord[]> {
  if (await isNativeHotStoreReady()) {
    return listNativeGameRecords<WhackMoleGameRecord>(userId, GAME_TYPE, limit);
  }
  return await kv.lrange<WhackMoleGameRecord>(RECORDS_KEY(userId), 0, limit - 1) ?? [];
}

export async function getActiveWhackMoleSession(userId: number): Promise<WhackMoleGameSession | null> {
  if (await isNativeHotStoreReady()) {
    return normalizeSession(await getNativeActiveGameSession<WhackMoleGameSession>(userId, GAME_TYPE));
  }

  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) {
    return null;
  }

  const session = normalizeSession(await kv.get<WhackMoleGameSession>(SESSION_KEY(activeSessionId)));
  if (!session) {
    await kv.del(ACTIVE_SESSION_KEY(userId));
    return null;
  }

  return session;
}

export async function startWhackMoleGame(
  userId: number,
  options: { restartActive?: boolean } = {},
): Promise<{ success: boolean; session?: WhackMoleGameSession; message?: string }> {
  const useNativeHotStore = await isNativeHotStoreReady();
  const startLockKey = START_LOCK_KEY(userId);
  const startLockToken = await acquireGameLock(startLockKey, START_LOCK_TTL, useNativeHotStore);
  if (!startLockToken) {
    return { success: false, message: '操作过于频繁，请稍后再试' };
  }

  try {
  if (await isInWhackMoleCooldown(userId)) {
    const remaining = await getWhackMoleCooldownRemaining(userId);
    return { success: false, message: `请等待 ${remaining} 秒后再开始游戏` };
  }

  if (useNativeHotStore) {
    const activeSession = await getNativeActiveGameSession<WhackMoleGameSession>(userId, GAME_TYPE);
    if (activeSession?.status === 'playing' && Date.now() < activeSession.expiresAt) {
      if (!options.restartActive) {
        return { success: false, message: '你已有正在进行的游戏' };
      }
      await cancelNativeGameSession(userId, GAME_TYPE, 0);
    }
  } else {
    const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
    if (activeSessionId) {
      const activeSession = await kv.get<WhackMoleGameSession>(SESSION_KEY(activeSessionId));
      if (!activeSession) {
        await kv.del(ACTIVE_SESSION_KEY(userId));
      } else if (activeSession.status === 'playing' && Date.now() < activeSession.expiresAt && !options.restartActive) {
        return { success: false, message: '你已有正在进行的游戏' };
      } else {
        await clearLegacySession(activeSessionId, userId);
      }
    }
  }

  const session = buildSession(userId);
  await saveSession(session, useNativeHotStore);

  return { success: true, session };
  } finally {
    await releaseGameLock(startLockKey, startLockToken, useNativeHotStore);
  }
}

export async function cancelWhackMoleGame(userId: number): Promise<{ success: boolean; message?: string }> {
  if (await isNativeHotStoreReady()) {
    const cancelled = await cancelNativeGameSession(userId, GAME_TYPE, COOLDOWN_TTL);
    return cancelled ? { success: true } : { success: false, message: '没有正在进行的游戏' };
  }

  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) {
    return { success: false, message: '没有正在进行的游戏' };
  }

  await clearLegacySession(activeSessionId, userId);
  await kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL });
  return { success: true };
}

export async function hitWhackMoleTarget(
  userId: number,
  payload: WhackMoleHitPayload,
): Promise<{ success: boolean; data?: WhackMoleHitResponse; message?: string }> {
  const payloadCheck = validateHitPayload(payload);
  if (!payloadCheck.ok) {
    return { success: false, message: payloadCheck.message };
  }

  const useNativeHotStore = await isNativeHotStoreReady();
  const lockKey = HIT_LOCK_KEY(payload.sessionId);
  const lockToken = await acquireGameLock(lockKey, HIT_LOCK_TTL, useNativeHotStore);
  if (!lockToken) {
    return { success: false, message: '敲击过于频繁，请稍后再试' };
  }

  try {
    const session = await loadSessionById(payload.sessionId, useNativeHotStore);
    if (!session) {
      return { success: false, message: '游戏会话不存在或已过期' };
    }
    if (session.userId !== userId) {
      return { success: false, message: '会话不属于该用户' };
    }
    if (!await isCurrentActiveSession(userId, session.id, useNativeHotStore)) {
      return { success: false, message: '游戏会话已不是当前活跃局' };
    }
    if (session.status !== 'playing') {
      return { success: false, message: '游戏会话已结束' };
    }
    if (Date.now() > session.expiresAt) {
      if (!useNativeHotStore) {
        await clearLegacySession(payload.sessionId, userId);
      }
      return { success: false, message: '游戏会话已过期' };
    }

    const elapsedMs = Math.floor(Date.now() - session.startedAt);
    if (elapsedMs < 0) {
      return { success: false, message: '游戏已结束' };
    }

    const existingEvents = normalizeEvents(session.events);
    const clientElapsedMs = normalizeClientHitElapsedMs(payloadCheck.clientElapsedMs, elapsedMs);
    if (elapsedMs >= WHACK_MOLE_GAME_DURATION_MS && clientElapsedMs === undefined) {
      return { success: false, message: '游戏已结束' };
    }
    const hitResolution = resolveHitWithGrace(
      session.seed,
      existingEvents,
      payloadCheck.index,
      Math.min(elapsedMs, WHACK_MOLE_GAME_DURATION_MS - 1),
      clientElapsedMs,
    );
    const nextEvents = hitResolution.events;
    const rateCheck = validateEventsRate(nextEvents);
    if (!rateCheck.ok) {
      return { success: false, message: rateCheck.message };
    }

    const lastEvent = hitResolution.lastEvent;
    if (!lastEvent) {
      return { success: false, message: '敲击记录异常' };
    }

    const nextSession: WhackMoleGameSession = {
      ...session,
      events: nextEvents,
    };
    await saveSession(nextSession, useNativeHotStore);

    return {
      success: true,
      data: {
        ...buildSessionView(nextSession),
        result: lastEvent.result,
        scoreDelta: lastEvent.scoreDelta,
        comboAfter: lastEvent.comboAfter,
      },
    };
  } finally {
    await releaseGameLock(lockKey, lockToken, useNativeHotStore);
  }
}

export async function submitWhackMoleResult(
  userId: number,
  payload: WhackMoleResultSubmit,
): Promise<{ success: boolean; record?: WhackMoleGameRecord; pointsEarned?: number; message?: string }> {
  const payloadCheck = validateSubmitPayload(payload);
  if (!payloadCheck.ok) {
    return { success: false, message: payloadCheck.message };
  }

  const useNativeHotStore = await isNativeHotStoreReady();
  const lockKey = SUBMIT_LOCK_KEY(payload.sessionId);
  const lockToken = await acquireGameLock(lockKey, SESSION_TTL, useNativeHotStore);
  if (!lockToken) {
    return { success: false, message: '请勿重复提交' };
  }

  const releaseLock = async () => {
    await releaseGameLock(lockKey, lockToken, useNativeHotStore);
  };

  const session = await loadSessionById(payload.sessionId, useNativeHotStore);

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

  const serverDuration = Date.now() - session.startedAt;
  if (serverDuration < WHACK_MOLE_GAME_DURATION_MS) {
    await releaseLock();
    return { success: false, message: '游戏尚未结束' };
  }

  if (Date.now() > session.expiresAt) {
    if (!useNativeHotStore) {
      await clearLegacySession(payload.sessionId, userId);
    }
    await releaseLock();
    return { success: false, message: '游戏会话已过期' };
  }

  const candidateEvents = payload.events !== undefined
    ? normalizeEvents(payload.events)
    : normalizeEvents(session.events);
  const rateCheck = validateEventsRate(candidateEvents);
  if (!rateCheck.ok) {
    await releaseLock();
    return { success: false, message: rateCheck.message };
  }

  const scored = scoreWhackMoleEvents(session.seed, candidateEvents);
  const pointReward = calculateWhackMolePointReward(scored.score);
  const dailyPointsLimit = await getDailyPointsLimit();
  const pointsResult = await addGamePointsWithLimit(
    userId,
    pointReward,
    dailyPointsLimit,
    'game_play',
    `打地鼠得分 ${scored.score}，福利积分 ${pointReward}`,
  );

  const stats: WhackMoleScoreStats = scored.stats;
  const record: WhackMoleGameRecord = {
    id: nanoid(),
    userId,
    sessionId: payload.sessionId,
    gameType: GAME_TYPE,
    score: scored.score,
    pointsEarned: pointsResult.pointsEarned,
    hits: stats.hits,
    goldenHits: stats.goldenHits,
    misses: stats.misses,
    bombs: stats.bombs,
    maxCombo: stats.maxCombo,
    duration: Math.min(serverDuration, WHACK_MOLE_GAME_DURATION_MS),
    createdAt: Date.now(),
  };

  if (useNativeHotStore) {
    await incrementSharedDailyStats(userId, scored.score, pointsResult.dailyEarned);
    await completeNativeGameSettlement(
      record,
      payload.sessionId,
      scored.score,
      pointsResult.dailyEarned,
      COOLDOWN_TTL,
    );
  } else {
    await Promise.all([
      clearLegacySession(payload.sessionId, userId),
      kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL }),
      incrementSharedDailyStats(userId, scored.score, pointsResult.dailyEarned),
      kv.lpush(RECORDS_KEY(userId), record).then(() =>
        kv.ltrim(RECORDS_KEY(userId), 0, MAX_RECORD_ENTRIES - 1),
      ),
    ]);
  }

  return { success: true, record, pointsEarned: pointsResult.pointsEarned };
}
