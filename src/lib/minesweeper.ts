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
  MINESWEEPER_DIFFICULTY_CONFIG,
  MINESWEEPER_MAX_ACTIONS,
  buildMinesweeperStateView,
  calculateMinesweeperPointReward,
  calculateMinesweeperScore,
  createInitialMinesweeperState,
  resolveMinesweeperAction,
  type MinesweeperAction,
  type MinesweeperDifficulty,
  type MinesweeperGameState,
  type MinesweeperScoreBreakdown,
  type MinesweeperStateView,
} from './minesweeper-engine';
import type { GameSessionStatus } from './types/game';

export { getDailyStats };

const GAME_TYPE = 'minesweeper' as const;
const SESSION_TTL = 30 * 60;
const COOLDOWN_TTL = 5;
const MAX_RECORD_ENTRIES = 50;
const STEP_LOCK_TTL = 3;
const START_LOCK_TTL = 3;

const SESSION_KEY = (sessionId: string) => `minesweeper:session:${sessionId}`;
const ACTIVE_SESSION_KEY = (userId: number) => `minesweeper:active:${userId}`;
const RECORDS_KEY = (userId: number) => `minesweeper:records:${userId}`;
const COOLDOWN_KEY = (userId: number) => `minesweeper:cooldown:${userId}`;
const STEP_LOCK_KEY = (sessionId: string) => `minesweeper:step:${sessionId}`;
const SUBMIT_LOCK_KEY = (sessionId: string) => `minesweeper:submit:${sessionId}`;
const START_LOCK_KEY = (userId: number) => `minesweeper:start:${userId}`;

export interface MinesweeperGameSession {
  id: string;
  userId: number;
  gameType: typeof GAME_TYPE;
  difficulty: MinesweeperDifficulty;
  seed: string;
  startedAt: number;
  expiresAt: number;
  status: GameSessionStatus;
  state: MinesweeperGameState;
  actions: MinesweeperAction[];
}

export interface MinesweeperGameRecord {
  id: string;
  userId: number;
  sessionId: string;
  gameType: typeof GAME_TYPE;
  difficulty: MinesweeperDifficulty;
  won: boolean;
  score: number;
  pointsEarned: number;
  duration: number;
  moves: number;
  flagsUsed: number;
  revealedSafe: number;
  mines: number;
  scoreBreakdown: MinesweeperScoreBreakdown;
  createdAt: number;
}

export interface MinesweeperGameStepPayload {
  sessionId: string;
  action: MinesweeperAction;
}

export interface MinesweeperGameResultSubmit {
  sessionId: string;
}

export interface MinesweeperSessionView {
  sessionId: string;
  difficulty: MinesweeperDifficulty;
  startedAt: number;
  expiresAt: number;
  actionsCount: number;
  state: MinesweeperStateView;
  scorePreview?: MinesweeperScoreBreakdown;
  pointRewardPreview?: number;
}

function generateSeed(): string {
  return randomBytes(16).toString('hex');
}

function getSessionTtlSeconds(expiresAt: number): number {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
}

function isDifficulty(value: unknown): value is MinesweeperDifficulty {
  return typeof value === 'string' && value in MINESWEEPER_DIFFICULTY_CONFIG;
}

function buildSession(userId: number, difficulty: MinesweeperDifficulty): MinesweeperGameSession {
  const now = Date.now();
  const seed = generateSeed();
  return {
    id: nanoid(),
    userId,
    gameType: GAME_TYPE,
    difficulty,
    seed,
    startedAt: now,
    expiresAt: now + SESSION_TTL * 1000,
    status: 'playing',
    state: createInitialMinesweeperState(seed, difficulty),
    actions: [],
  };
}

function buildSessionView(session: MinesweeperGameSession): MinesweeperSessionView {
  const scorePreview = session.state.status === 'playing'
    ? undefined
    : calculateMinesweeperScore(session.state, getSessionDuration(session));

  return {
    sessionId: session.id,
    difficulty: session.difficulty,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    actionsCount: session.actions.length,
    state: buildMinesweeperStateView(session.state),
    scorePreview,
    pointRewardPreview: scorePreview ? calculateMinesweeperPointReward(scorePreview.total) : undefined,
  };
}

function getSessionDuration(session: Pick<MinesweeperGameSession, 'startedAt' | 'state'>): number {
  const endAt = session.state.status === 'playing'
    ? Date.now()
    : (typeof session.state.endedAt === 'number' ? session.state.endedAt : Date.now());
  return Math.max(0, endAt - session.startedAt);
}

function normalizeActions(value: unknown): MinesweeperAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter((action): action is MinesweeperAction =>
    Boolean(action) && typeof action === 'object' && typeof (action as { type?: unknown }).type === 'string',
  );
}

function normalizeSession(raw: unknown): MinesweeperGameSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const session = raw as Partial<MinesweeperGameSession>;
  if (
    typeof session.id !== 'string'
    || typeof session.userId !== 'number'
    || session.gameType !== GAME_TYPE
    || !isDifficulty(session.difficulty)
    || typeof session.seed !== 'string'
    || typeof session.startedAt !== 'number'
    || typeof session.expiresAt !== 'number'
    || typeof session.status !== 'string'
    || !session.state
  ) {
    return null;
  }

  return {
    id: session.id,
    userId: session.userId,
    gameType: GAME_TYPE,
    difficulty: session.difficulty,
    seed: session.seed,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    status: session.status as GameSessionStatus,
    state: session.state,
    actions: normalizeActions(session.actions),
  };
}

function normalizePosition(value: unknown): { row: number; col: number } | null {
  if (!value || typeof value !== 'object') return null;
  const position = value as { row?: unknown; col?: unknown };
  if (typeof position.row !== 'number' || typeof position.col !== 'number') return null;
  if (!Number.isInteger(position.row) || !Number.isInteger(position.col)) return null;
  return { row: position.row, col: position.col };
}

function normalizeAction(value: unknown): MinesweeperAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== 'reveal' && raw.type !== 'flag' && raw.type !== 'chord') {
    return null;
  }
  const position = normalizePosition(raw.position);
  return position ? { type: raw.type, position } : null;
}

function validateStepPayload(
  payload: MinesweeperGameStepPayload,
): { ok: true; action: MinesweeperAction } | { ok: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '无效的请求数据' };
  }
  if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    return { ok: false, message: '无效的会话ID' };
  }
  const action = normalizeAction(payload.action);
  if (!action) {
    return { ok: false, message: '无效的扫雷操作' };
  }
  return { ok: true, action };
}

function validateSubmitPayload(payload: MinesweeperGameResultSubmit): { ok: true } | { ok: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '无效的提交数据' };
  }
  if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    return { ok: false, message: '无效的会话ID' };
  }
  return { ok: true };
}

async function saveSession(session: MinesweeperGameSession, useNativeHotStore: boolean): Promise<void> {
  if (useNativeHotStore) {
    await createNativeGameSession(session);
    return;
  }

  const ttl = getSessionTtlSeconds(session.expiresAt);
  await kv.set(SESSION_KEY(session.id), session, { ex: ttl });
  await kv.set(ACTIVE_SESSION_KEY(session.userId), session.id, { ex: ttl });
}

async function deleteSession(sessionId: string, userId: number, useNativeHotStore: boolean): Promise<void> {
  if (useNativeHotStore) return;
  await Promise.all([
    kv.del(SESSION_KEY(sessionId)),
    kv.del(ACTIVE_SESSION_KEY(userId)),
  ]);
}

async function loadSessionById(sessionId: string, useNativeHotStore: boolean): Promise<MinesweeperGameSession | null> {
  const raw = useNativeHotStore
    ? await getNativeGameSession<MinesweeperGameSession>(sessionId)
    : await kv.get<MinesweeperGameSession>(SESSION_KEY(sessionId));
  return normalizeSession(raw);
}

async function isCurrentActiveSession(
  userId: number,
  sessionId: string,
  useNativeHotStore: boolean,
): Promise<boolean> {
  if (useNativeHotStore) {
    const activeSession = await getNativeActiveGameSession<MinesweeperGameSession>(userId, GAME_TYPE);
    return activeSession?.id === sessionId;
  }

  return (await kv.get<string>(ACTIVE_SESSION_KEY(userId))) === sessionId;
}

export function buildMinesweeperSessionView(session: MinesweeperGameSession): MinesweeperSessionView {
  return buildSessionView(session);
}

export async function isInMinesweeperCooldown(userId: number): Promise<boolean> {
  if (await isNativeHotStoreReady()) {
    return (await getNativeGameCooldownRemaining(userId, GAME_TYPE)) > 0;
  }
  return (await kv.get(COOLDOWN_KEY(userId))) !== null;
}

export async function getMinesweeperCooldownRemaining(userId: number): Promise<number> {
  if (await isNativeHotStoreReady()) {
    return getNativeGameCooldownRemaining(userId, GAME_TYPE);
  }
  const ttl = await kv.ttl(COOLDOWN_KEY(userId));
  return ttl > 0 ? ttl : 0;
}

export async function getMinesweeperRecords(userId: number, limit: number = 20): Promise<MinesweeperGameRecord[]> {
  if (await isNativeHotStoreReady()) {
    return listNativeGameRecords<MinesweeperGameRecord>(userId, GAME_TYPE, limit);
  }
  return (await kv.lrange<MinesweeperGameRecord>(RECORDS_KEY(userId), 0, limit - 1)) ?? [];
}

export async function getActiveMinesweeperSession(userId: number): Promise<MinesweeperGameSession | null> {
  const useNativeHotStore = await isNativeHotStoreReady();
  if (useNativeHotStore) {
    return normalizeSession(await getNativeActiveGameSession<MinesweeperGameSession>(userId, GAME_TYPE));
  }

  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) return null;

  const session = normalizeSession(await kv.get<MinesweeperGameSession>(SESSION_KEY(activeSessionId)));
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

export async function startMinesweeperGame(
  userId: number,
  difficulty: MinesweeperDifficulty,
  options: { restartActive?: boolean } = {},
): Promise<{ success: boolean; session?: MinesweeperGameSession; message?: string }> {
  const useNativeHotStore = await isNativeHotStoreReady();
  const startLockKey = START_LOCK_KEY(userId);
  const startLockToken = await acquireGameLock(startLockKey, START_LOCK_TTL, useNativeHotStore);
  if (!startLockToken) {
    return { success: false, message: '操作过于频繁，请稍后再试' };
  }

  try {

  if (!isDifficulty(difficulty)) {
    return { success: false, message: '无效的难度' };
  }
  if (await isInMinesweeperCooldown(userId)) {
    const remaining = await getMinesweeperCooldownRemaining(userId);
    return { success: false, message: `请等待 ${remaining} 秒后再开始游戏` };
  }

  const activeSession = await getActiveMinesweeperSession(userId);
  if (activeSession?.status === 'playing' && Date.now() < activeSession.expiresAt) {
    if (!options.restartActive) {
      return { success: false, message: '你已有正在进行的游戏' };
    }
    if (useNativeHotStore) {
      await cancelNativeGameSession(userId, GAME_TYPE, 0);
    } else {
      await deleteSession(activeSession.id, userId, false);
    }
  } else if (activeSession) {
    await deleteSession(activeSession.id, userId, useNativeHotStore);
  }

  const session = buildSession(userId, difficulty);
  await saveSession(session, useNativeHotStore);
  return { success: true, session };
  } finally {
    await releaseGameLock(startLockKey, startLockToken, useNativeHotStore);
  }
}

export async function cancelMinesweeperGame(userId: number): Promise<{ success: boolean; message?: string }> {
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

export async function stepMinesweeperGame(
  userId: number,
  payload: MinesweeperGameStepPayload,
): Promise<{ success: boolean; session?: MinesweeperSessionView; outcome?: unknown; message?: string }> {
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
    if (!session) return { success: false, message: '游戏会话不存在或已过期' };
    if (session.userId !== userId) return { success: false, message: '会话不属于该用户' };
    if (!await isCurrentActiveSession(userId, session.id, useNativeHotStore)) {
      return { success: false, message: '游戏会话已不是当前活跃局' };
    }
    if (session.status !== 'playing') return { success: false, message: '游戏会话已结束' };
    if (Date.now() > session.expiresAt) {
      await deleteSession(session.id, userId, useNativeHotStore);
      return { success: false, message: '游戏会话已过期' };
    }
    if (session.actions.length >= MINESWEEPER_MAX_ACTIONS) {
      return { success: false, message: '操作次数过多' };
    }

    const resolved = resolveMinesweeperAction(session.state, payloadCheck.action);
    if (!resolved.ok) {
      return { success: false, message: resolved.message };
    }
    if (resolved.state.status !== 'playing' && typeof resolved.state.endedAt !== 'number') {
      resolved.state.endedAt = Date.now();
    }

    const nextSession: MinesweeperGameSession = {
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

export async function submitMinesweeperResult(
  userId: number,
  payload: MinesweeperGameResultSubmit,
): Promise<{ success: boolean; record?: MinesweeperGameRecord; pointsEarned?: number; message?: string }> {
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

  const duration = getSessionDuration(session);
  const scoreBreakdown = calculateMinesweeperScore(session.state, duration);
  const score = scoreBreakdown.total;
  const pointReward = calculateMinesweeperPointReward(score);
  const dailyPointsLimit = await getDailyPointsLimit();
  const pointsResult = await addGamePointsWithLimit(
    userId,
    pointReward,
    dailyPointsLimit,
    'game_play',
    `扫雷${session.state.status === 'won' ? '成功' : '失败'}（${MINESWEEPER_DIFFICULTY_CONFIG[session.difficulty].label}）得分 ${score}，福利积分 ${pointReward}`,
  );

  const record: MinesweeperGameRecord = {
    id: nanoid(),
    userId,
    sessionId: session.id,
    gameType: GAME_TYPE,
    difficulty: session.difficulty,
    won: session.state.status === 'won',
    score,
    pointsEarned: pointsResult.pointsEarned,
    duration,
    moves: session.state.moves,
    flagsUsed: session.state.flagsUsed,
    revealedSafe: session.state.revealedSafe,
    mines: session.state.mines,
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
