import { randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { kv } from '@/lib/d1-kv';
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
import {
  buildRogueliteStateView,
  calculateRoguelitePointReward,
  calculateRogueliteScore,
  createInitialRogueliteState,
  isCurrentRogueliteState,
  isValidWorldPosition,
  resolveRogueliteAction,
  type RogueliteAction,
  type RogueliteActionOutcome,
  type RogueliteGameState,
  type RoguelitePosition,
  type RogueliteScoreBreakdown,
  type RogueliteStateView,
} from './roguelite-engine';
import type { GameSessionStatus } from './types/game';

export { getDailyStats };

const GAME_TYPE = 'roguelite' as const;
const SESSION_TTL = 30 * 60;
const COOLDOWN_TTL = 5;
const MAX_RECORD_ENTRIES = 50;
const MAX_ACTIONS = 360;
const STEP_LOCK_TTL = 3;
const MIN_FINISH_DURATION_MS = 2_000;
const START_LOCK_TTL = 3;

const SESSION_KEY = (sessionId: string) => `roguelite:session:${sessionId}`;
const ACTIVE_SESSION_KEY = (userId: number) => `roguelite:active:${userId}`;
const RECORDS_KEY = (userId: number) => `roguelite:records:${userId}`;
const COOLDOWN_KEY = (userId: number) => `roguelite:cooldown:${userId}`;
const SUBMIT_LOCK_KEY = (sessionId: string) => `roguelite:submit:${sessionId}`;
const STEP_LOCK_KEY = (sessionId: string) => `roguelite:step:${sessionId}`;
const START_LOCK_KEY = (userId: number) => `roguelite:start:${userId}`;

export interface RogueliteGameSession {
  id: string;
  userId: number;
  gameType: typeof GAME_TYPE;
  seed: string;
  startedAt: number;
  expiresAt: number;
  status: GameSessionStatus;
  state: RogueliteGameState;
  actions: RogueliteAction[];
}

export interface RogueliteGameRecord {
  id: string;
  userId: number;
  sessionId: string;
  gameType: typeof GAME_TYPE;
  won: boolean;
  finalFloor: number;
  floorsCleared: number;
  score: number;
  pointsEarned: number;
  stardust: number;
  hpRemaining: number;
  relics: number;
  monstersDefeated: number;
  chestsOpened: number;
  stepsUsed: number;
  duration: number;
  scoreBreakdown: RogueliteScoreBreakdown;
  createdAt: number;
}

export interface RogueliteGameStepPayload {
  sessionId: string;
  action: RogueliteAction;
}

export interface RogueliteGameResultSubmit {
  sessionId: string;
}

export interface RogueliteSessionView {
  sessionId: string;
  startedAt: number;
  expiresAt: number;
  actionsCount: number;
  state: RogueliteStateView;
}

function generateSeed(): string {
  return randomBytes(16).toString('hex');
}

function getSessionTtlSeconds(expiresAt: number): number {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
}

function generateSession(userId: number): RogueliteGameSession {
  const now = Date.now();
  const seed = generateSeed();
  return {
    id: nanoid(),
    userId,
    gameType: GAME_TYPE,
    seed,
    startedAt: now,
    expiresAt: now + SESSION_TTL * 1000,
    status: 'playing',
    state: createInitialRogueliteState(seed),
    actions: [],
  };
}

function normalizeActions(actions: unknown): RogueliteAction[] {
  if (!Array.isArray(actions)) {
    return [];
  }
  return actions.filter((action): action is RogueliteAction =>
    Boolean(action) && typeof action === 'object' && typeof (action as { type?: unknown }).type === 'string',
  );
}

function normalizeRogueliteSession(raw: unknown): RogueliteGameSession | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const session = raw as Partial<RogueliteGameSession>;
  if (
    typeof session.id !== 'string'
    || typeof session.userId !== 'number'
    || typeof session.seed !== 'string'
    || typeof session.startedAt !== 'number'
    || typeof session.expiresAt !== 'number'
    || typeof session.status !== 'string'
    || !session.state
  ) {
    return null;
  }
  if (!isCurrentRogueliteState(session.state)) {
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
    state: session.state,
    actions: normalizeActions(session.actions),
  };
}

function buildSessionView(session: RogueliteGameSession): RogueliteSessionView {
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    actionsCount: session.actions.length,
    state: buildRogueliteStateView(session.state),
  };
}

async function saveSession(session: RogueliteGameSession, useNativeHotStore: boolean): Promise<void> {
  if (useNativeHotStore) {
    await createNativeGameSession(session);
    return;
  }

  const ttl = getSessionTtlSeconds(session.expiresAt);
  await kv.set(SESSION_KEY(session.id), session, { ex: ttl });
  await kv.set(ACTIVE_SESSION_KEY(session.userId), session.id, { ex: ttl });
}

async function deleteSession(sessionId: string, userId: number, useNativeHotStore: boolean): Promise<void> {
  if (useNativeHotStore) {
    return;
  }
  await Promise.all([
    kv.del(SESSION_KEY(sessionId)),
    kv.del(ACTIVE_SESSION_KEY(userId)),
  ]);
}

async function loadSessionById(sessionId: string, useNativeHotStore: boolean): Promise<RogueliteGameSession | null> {
  const raw = useNativeHotStore
    ? await getNativeGameSession<RogueliteGameSession>(sessionId)
    : await kv.get<RogueliteGameSession>(SESSION_KEY(sessionId));
  return normalizeRogueliteSession(raw);
}

async function isCurrentActiveSession(
  userId: number,
  sessionId: string,
  useNativeHotStore: boolean,
): Promise<boolean> {
  if (useNativeHotStore) {
    const activeSession = await getNativeActiveGameSession<RogueliteGameSession>(userId, GAME_TYPE);
    return activeSession?.id === sessionId;
  }

  return (await kv.get<string>(ACTIVE_SESSION_KEY(userId))) === sessionId;
}

function normalizePosition(value: unknown): RoguelitePosition | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const position = value as Partial<RoguelitePosition>;
  if (!Number.isInteger(position.row) || !Number.isInteger(position.col)) {
    return null;
  }
  const result = { row: Number(position.row), col: Number(position.col) };
  return isValidWorldPosition(result) ? result : null;
}

function normalizeAction(value: unknown): RogueliteAction | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  if (raw.type === 'move') {
    const to = normalizePosition(raw.to);
    return to ? { type: 'move', to } : null;
  }
  if (raw.type === 'combat') {
    if (raw.style === 'attack' || raw.style === 'guard' || raw.style === 'skill') {
      return { type: 'combat', style: raw.style };
    }
    return null;
  }
  if (raw.type === 'event') {
    return typeof raw.optionId === 'string' ? { type: 'event', optionId: raw.optionId } : null;
  }
  if (raw.type === 'shop') {
    return typeof raw.itemId === 'string' ? { type: 'shop', itemId: raw.itemId } : null;
  }
  if (raw.type === 'chest') {
    return typeof raw.open === 'boolean' ? { type: 'chest', open: raw.open } : null;
  }
  if (raw.type === 'escape') {
    return { type: 'escape' };
  }

  return null;
}

function validateStepPayload(
  payload: RogueliteGameStepPayload,
): { ok: true; action: RogueliteAction } | { ok: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '无效的请求数据' };
  }
  if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    return { ok: false, message: '无效的会话ID' };
  }

  const action = normalizeAction(payload.action);
  if (!action) {
    return { ok: false, message: '无效的行动参数' };
  }

  return { ok: true, action };
}

function validateSubmitPayload(payload: RogueliteGameResultSubmit): { ok: true } | { ok: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '无效的提交数据' };
  }
  if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    return { ok: false, message: '无效的会话ID' };
  }
  return { ok: true };
}

export async function isInRogueliteCooldown(userId: number): Promise<boolean> {
  if (await isNativeHotStoreReady()) {
    return (await getNativeGameCooldownRemaining(userId, GAME_TYPE)) > 0;
  }
  return (await kv.get(COOLDOWN_KEY(userId))) !== null;
}

export async function getRogueliteCooldownRemaining(userId: number): Promise<number> {
  if (await isNativeHotStoreReady()) {
    return getNativeGameCooldownRemaining(userId, GAME_TYPE);
  }
  const ttl = await kv.ttl(COOLDOWN_KEY(userId));
  return ttl > 0 ? ttl : 0;
}

export async function getRogueliteRecords(userId: number, limit: number = 20): Promise<RogueliteGameRecord[]> {
  if (await isNativeHotStoreReady()) {
    return listNativeGameRecords<RogueliteGameRecord>(userId, GAME_TYPE, limit);
  }
  return (await kv.lrange<RogueliteGameRecord>(RECORDS_KEY(userId), 0, limit - 1)) ?? [];
}

export async function getActiveRogueliteSession(userId: number): Promise<RogueliteGameSession | null> {
  const useNativeHotStore = await isNativeHotStoreReady();
  if (useNativeHotStore) {
    return normalizeRogueliteSession(await getNativeActiveGameSession<RogueliteGameSession>(userId, GAME_TYPE));
  }

  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) {
    return null;
  }

  const session = normalizeRogueliteSession(await kv.get<RogueliteGameSession>(SESSION_KEY(activeSessionId)));
  if (!session) {
    await kv.del(ACTIVE_SESSION_KEY(userId));
    return null;
  }
  if (Date.now() > session.expiresAt) {
    await deleteSession(session.id, userId, false);
    return null;
  }
  return session;
}

export function buildRogueliteSessionView(session: RogueliteGameSession): RogueliteSessionView {
  return buildSessionView(session);
}

export async function startRogueliteGame(
  userId: number,
): Promise<{ success: boolean; session?: RogueliteGameSession; message?: string }> {
  const useNativeHotStore = await isNativeHotStoreReady();
  const startLockKey = START_LOCK_KEY(userId);
  const startLockToken = await acquireGameLock(startLockKey, START_LOCK_TTL, useNativeHotStore);
  if (!startLockToken) {
    return { success: false, message: '操作过于频繁，请稍后再试' };
  }

  try {

  if (await isInRogueliteCooldown(userId)) {
    const remaining = await getRogueliteCooldownRemaining(userId);
    return { success: false, message: `请等待 ${remaining} 秒后再开始游戏` };
  }

  const activeSession = await getActiveRogueliteSession(userId);
  if (activeSession?.status === 'playing' && Date.now() < activeSession.expiresAt) {
    return { success: false, message: '你已有正在进行的游戏' };
  }
  if (activeSession) {
    await deleteSession(activeSession.id, userId, useNativeHotStore);
  }

  const session = generateSession(userId);
  await saveSession(session, useNativeHotStore);
  return { success: true, session };
  } finally {
    await releaseGameLock(startLockKey, startLockToken, useNativeHotStore);
  }
}

export async function cancelRogueliteGame(userId: number): Promise<{ success: boolean; message?: string }> {
  if (await isNativeHotStoreReady()) {
    const cancelled = await cancelNativeGameSession(userId, GAME_TYPE, COOLDOWN_TTL);
    return cancelled ? { success: true } : { success: false, message: '没有正在进行的游戏' };
  }

  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) {
    return { success: false, message: '没有正在进行的游戏' };
  }
  await deleteSession(activeSessionId, userId, false);
  await kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL });
  return { success: true };
}

export async function stepRogueliteGame(
  userId: number,
  payload: RogueliteGameStepPayload,
): Promise<{ success: boolean; session?: RogueliteSessionView; outcome?: RogueliteActionOutcome; message?: string }> {
  const payloadCheck = validateStepPayload(payload);
  if (!payloadCheck.ok) {
    return { success: false, message: payloadCheck.message };
  }

  const useNativeHotStore = await isNativeHotStoreReady();
  const lockKey = STEP_LOCK_KEY(payload.sessionId);
  const lockToken = await acquireGameLock(lockKey, STEP_LOCK_TTL, useNativeHotStore);
  if (!lockToken) {
    return { success: false, message: '操作过于频繁，请稍后再试' };
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
      await deleteSession(session.id, session.userId, useNativeHotStore);
      return { success: false, message: '游戏会话已过期' };
    }
    if (session.actions.length >= MAX_ACTIONS) {
      return { success: false, message: '行动次数过多' };
    }

    const resolved = resolveRogueliteAction(session.state, payloadCheck.action);
    if (!resolved.ok) {
      return { success: false, message: resolved.message };
    }

    const nextSession: RogueliteGameSession = {
      ...session,
      state: resolved.state,
      actions: [...session.actions, payloadCheck.action],
    };

    await saveSession(nextSession, useNativeHotStore);

    return {
      success: true,
      session: buildSessionView(nextSession),
      outcome: resolved.outcome,
    };
  } finally {
    await releaseGameLock(lockKey, lockToken, useNativeHotStore);
  }
}

export async function submitRogueliteResult(
  userId: number,
  payload: RogueliteGameResultSubmit,
): Promise<{ success: boolean; record?: RogueliteGameRecord; pointsEarned?: number; message?: string }> {
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
  if (Date.now() > session.expiresAt) {
    await deleteSession(session.id, userId, useNativeHotStore);
    await releaseLock();
    return { success: false, message: '游戏会话已过期' };
  }
  if (session.state.status === 'playing') {
    await releaseLock();
    return { success: false, message: '请先完成本局再结算' };
  }

  const serverDuration = Date.now() - session.startedAt;
  if (session.state.status === 'escaped' && serverDuration < MIN_FINISH_DURATION_MS) {
    await releaseLock();
    return { success: false, message: '游戏时长过短' };
  }

  const scoreBreakdown = calculateRogueliteScore(session.state);
  const score = scoreBreakdown.total;
  const pointReward = calculateRoguelitePointReward(score);
  const dailyPointsLimit = await getDailyPointsLimit();
  const pointsResult = await addGamePointsWithLimit(
    userId,
    pointReward,
    dailyPointsLimit,
    'game_play',
    `星尘迷阵 ${session.state.status === 'escaped' ? '成功撤离' : `第${session.state.floor}层失败`} 得分 ${score}，福利积分 ${pointReward}`,
  );

  const record: RogueliteGameRecord = {
    id: nanoid(),
    userId,
    sessionId: session.id,
    gameType: GAME_TYPE,
    won: session.state.status === 'escaped',
    finalFloor: session.state.floor,
    floorsCleared: session.state.player.floorsCleared,
    score,
    pointsEarned: pointsResult.pointsEarned,
    stardust: session.state.player.stardust,
    hpRemaining: Math.max(0, session.state.player.hp),
    relics: session.state.player.relics.length,
    monstersDefeated: session.state.player.monstersDefeated,
    chestsOpened: session.state.player.chestsOpened,
    stepsUsed: session.actions.filter((action) => action.type === 'move').length,
    duration: serverDuration,
    scoreBreakdown,
    createdAt: Date.now(),
  };

  if (useNativeHotStore) {
    await incrementSharedDailyStats(userId, score, pointsResult.dailyEarned);
    await completeNativeGameSettlement(
      record,
      session.id,
      score,
      pointsResult.dailyEarned,
      COOLDOWN_TTL,
    );
  } else {
    await Promise.all([
      deleteSession(session.id, userId, false),
      kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL }),
      incrementSharedDailyStats(userId, score, pointsResult.dailyEarned),
      kv.lpush(RECORDS_KEY(userId), record).then(() => kv.ltrim(RECORDS_KEY(userId), 0, MAX_RECORD_ENTRIES - 1)),
    ]);
  }

  return { success: true, record, pointsEarned: pointsResult.pointsEarned };
}
