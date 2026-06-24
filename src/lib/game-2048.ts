import { randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { kv } from '@/lib/d1-kv';
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
  updateNativeGameSession,
} from './hot-d1';
import { acquireGameLock, releaseGameLock } from './game-locks';
import {
  GAME2048_MAX_MOVES,
  GAME2048_WIN_TILE,
  calculateGame2048PointReward,
  createInitialGame2048Grid,
  getGame2048HighestTile,
  isGame2048Over,
  isValidGame2048Grid,
  moveGame2048Grid,
  normalizeGame2048Moves,
  spawnGame2048Tile,
  type Game2048Direction,
  type Game2048Grid,
  type Game2048SimulationResult,
} from './game-2048-engine';
import type { GameSessionStatus } from './types/game';

export { getDailyStats };

const GAME_TYPE = 'game_2048' as const;
const SESSION_TTL = 2 * 60 * 60;
const COOLDOWN_TTL = 5;
const MAX_RECORD_ENTRIES = 50;
const START_LOCK_TTL = 3;
const SUBMIT_LOCK_TTL = 20;
const CHECKPOINT_LOCK_TTL = 20;

const SESSION_KEY = (sessionId: string) => `game_2048:session:${sessionId}`;
const ACTIVE_SESSION_KEY = (userId: number) => `game_2048:active:${userId}`;
const RECORDS_KEY = (userId: number) => `game_2048:records:${userId}`;
const COOLDOWN_KEY = (userId: number) => `game_2048:cooldown:${userId}`;
const START_LOCK_KEY = (userId: number) => `game_2048:start:${userId}`;
const SUBMIT_LOCK_KEY = (sessionId: string) => `game_2048:submit:${sessionId}`;
const CHECKPOINT_LOCK_KEY = (sessionId: string) => `game_2048:checkpoint:${sessionId}`;

export interface Game2048Session {
  id: string;
  userId: number;
  gameType: typeof GAME_TYPE;
  seed: string;
  startedAt: number;
  expiresAt: number;
  status: GameSessionStatus;
  checkpointGrid?: Game2048Grid;
  checkpointScore?: number;
  checkpointMovesApplied?: number;
  checkpointMovesSubmitted?: number;
}

export interface Game2048SessionView {
  sessionId: string;
  seed: string;
  startedAt: number;
  expiresAt: number;
  initialGrid: Game2048Grid;
  baseScore: number;
  baseMoves: number;
  baseMovesSubmitted: number;
}

export interface Game2048Record {
  id: string;
  userId: number;
  sessionId: string;
  gameType: typeof GAME_TYPE;
  score: number;
  pointsEarned: number;
  highestTile: number;
  moves: number;
  movesSubmitted: number;
  won: boolean;
  gameOver: boolean;
  grid: Game2048Grid;
  duration: number;
  createdAt: number;
}

export interface Game2048ResultSubmit {
  sessionId: string;
  moves: Game2048Direction[];
}

export type Game2048CheckpointSubmit = Game2048ResultSubmit;

type Game2048SubmitResult = {
  success: boolean;
  record?: Game2048Record;
  pointsEarned?: number;
  message?: string;
  adminInsufficient?: boolean;
};

function generateSeed(): string {
  return randomBytes(16).toString('hex');
}

function buildSession(userId: number): Game2048Session {
  const now = Date.now();
  return {
    id: nanoid(),
    userId,
    gameType: GAME_TYPE,
    seed: generateSeed(),
    startedAt: now,
    expiresAt: now + SESSION_TTL * 1000,
    status: 'playing',
  };
}

function normalizeSession(raw: unknown): Game2048Session | null {
  if (!raw || typeof raw !== 'object') return null;
  const session = raw as Partial<Game2048Session>;
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
    checkpointGrid: isValidGame2048Grid(session.checkpointGrid) ? session.checkpointGrid : undefined,
    checkpointScore: typeof session.checkpointScore === 'number' && Number.isSafeInteger(session.checkpointScore) && session.checkpointScore >= 0
      ? session.checkpointScore
      : undefined,
    checkpointMovesApplied: typeof session.checkpointMovesApplied === 'number' && Number.isSafeInteger(session.checkpointMovesApplied) && session.checkpointMovesApplied >= 0
      ? session.checkpointMovesApplied
      : undefined,
    checkpointMovesSubmitted: typeof session.checkpointMovesSubmitted === 'number' && Number.isSafeInteger(session.checkpointMovesSubmitted) && session.checkpointMovesSubmitted >= 0
      ? session.checkpointMovesSubmitted
      : undefined,
  };
}

function getGame2048Checkpoint(session: Game2048Session): {
  grid: Game2048Grid;
  score: number;
  movesApplied: number;
  movesSubmitted: number;
} {
  if (
    isValidGame2048Grid(session.checkpointGrid)
    && typeof session.checkpointScore === 'number'
    && Number.isSafeInteger(session.checkpointScore)
    && session.checkpointScore >= 0
    && typeof session.checkpointMovesApplied === 'number'
    && Number.isSafeInteger(session.checkpointMovesApplied)
    && session.checkpointMovesApplied >= 0
    && typeof session.checkpointMovesSubmitted === 'number'
    && Number.isSafeInteger(session.checkpointMovesSubmitted)
    && session.checkpointMovesSubmitted >= session.checkpointMovesApplied
  ) {
    return {
      grid: session.checkpointGrid,
      score: session.checkpointScore,
      movesApplied: session.checkpointMovesApplied,
      movesSubmitted: session.checkpointMovesSubmitted,
    };
  }

  return {
    grid: createInitialGame2048Grid(session.seed),
    score: 0,
    movesApplied: 0,
    movesSubmitted: 0,
  };
}

function simulateGame2048Segment(
  session: Game2048Session,
  moves: Game2048Direction[],
): Game2048SimulationResult {
  const checkpoint = getGame2048Checkpoint(session);
  let grid = checkpoint.grid;
  let score = checkpoint.score;
  let movesApplied = checkpoint.movesApplied;

  for (const direction of moves) {
    const moved = moveGame2048Grid(grid, direction);
    if (!moved.moved) {
      continue;
    }

    score += moved.scoreDelta;
    grid = spawnGame2048Tile(moved.grid, session.seed, movesApplied + 2);
    movesApplied += 1;
  }

  const highestTile = getGame2048HighestTile(grid);
  return {
    grid,
    score,
    highestTile,
    movesSubmitted: checkpoint.movesSubmitted + moves.length,
    movesApplied,
    won: highestTile >= GAME2048_WIN_TILE,
    gameOver: isGame2048Over(grid),
  };
}

export function buildGame2048SessionView(session: Game2048Session): Game2048SessionView {
  const checkpoint = getGame2048Checkpoint(session);
  return {
    sessionId: session.id,
    seed: session.seed,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    initialGrid: checkpoint.grid,
    baseScore: checkpoint.score,
    baseMoves: checkpoint.movesApplied,
    baseMovesSubmitted: checkpoint.movesSubmitted,
  };
}

async function saveSession(session: Game2048Session, useNativeHotStore: boolean): Promise<void> {
  if (useNativeHotStore) {
    await createNativeGameSession(session);
    return;
  }

  const ttl = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));
  await kv.set(SESSION_KEY(session.id), session, { ex: ttl });
  await kv.set(ACTIVE_SESSION_KEY(session.userId), session.id, { ex: ttl });
}

async function updateSessionCheckpoint(session: Game2048Session, useNativeHotStore: boolean): Promise<void> {
  if (useNativeHotStore) {
    await updateNativeGameSession(session);
    return;
  }

  const ttl = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));
  await kv.set(SESSION_KEY(session.id), session, { ex: ttl });
  await kv.set(ACTIVE_SESSION_KEY(session.userId), session.id, { ex: ttl });
}

async function loadSessionById(
  sessionId: string,
  useNativeHotStore: boolean,
): Promise<Game2048Session | null> {
  const raw = useNativeHotStore
    ? await getNativeGameSession<Game2048Session>(sessionId)
    : await kv.get<Game2048Session>(SESSION_KEY(sessionId));
  return normalizeSession(raw);
}

async function clearLegacySession(sessionId: string, userId: number): Promise<void> {
  await Promise.all([
    kv.del(SESSION_KEY(sessionId)),
    kv.del(ACTIVE_SESSION_KEY(userId)),
  ]);
}

async function isCurrentActiveSession(
  userId: number,
  sessionId: string,
  useNativeHotStore: boolean,
): Promise<boolean> {
  if (useNativeHotStore) {
    const activeSession = await getNativeActiveGameSession<Game2048Session>(userId, GAME_TYPE);
    return activeSession?.id === sessionId;
  }

  return (await kv.get<string>(ACTIVE_SESSION_KEY(userId))) === sessionId;
}

export async function isInGame2048Cooldown(userId: number): Promise<boolean> {
  if (await isNativeHotStoreReady()) {
    return (await getNativeGameCooldownRemaining(userId, GAME_TYPE)) > 0;
  }
  return (await kv.get(COOLDOWN_KEY(userId))) !== null;
}

export async function getGame2048CooldownRemaining(userId: number): Promise<number> {
  if (await isNativeHotStoreReady()) {
    return getNativeGameCooldownRemaining(userId, GAME_TYPE);
  }
  const ttl = await kv.ttl(COOLDOWN_KEY(userId));
  return ttl > 0 ? ttl : 0;
}

export async function getGame2048Records(
  userId: number,
  limit: number = 20,
): Promise<Game2048Record[]> {
  if (await isNativeHotStoreReady()) {
    return listNativeGameRecords<Game2048Record>(userId, GAME_TYPE, limit);
  }
  return await kv.lrange<Game2048Record>(RECORDS_KEY(userId), 0, limit - 1) ?? [];
}

export async function getActiveGame2048Session(userId: number): Promise<Game2048Session | null> {
  if (await isNativeHotStoreReady()) {
    return normalizeSession(await getNativeActiveGameSession<Game2048Session>(userId, GAME_TYPE));
  }

  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) {
    return null;
  }

  const session = normalizeSession(await kv.get<Game2048Session>(SESSION_KEY(activeSessionId)));
  if (!session) {
    await kv.del(ACTIVE_SESSION_KEY(userId));
    return null;
  }

  return session;
}

async function findSettledGame2048Record(
  userId: number,
  sessionId: string,
  useNativeHotStore: boolean,
): Promise<Game2048Record | null> {
  const records = useNativeHotStore
    ? await listNativeGameRecords<Game2048Record>(userId, GAME_TYPE, MAX_RECORD_ENTRIES)
    : ((await kv.lrange<Game2048Record>(RECORDS_KEY(userId), 0, MAX_RECORD_ENTRIES - 1)) ?? []);

  return records.find((record) => record.sessionId === sessionId) ?? null;
}

function buildSettledGame2048Result(record: Game2048Record) {
  return { success: true as const, record, pointsEarned: record.pointsEarned };
}

function validateSubmitPayload(
  payload: Game2048ResultSubmit,
): { ok: true; sessionId: string; moves: Game2048Direction[] } | { ok: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '无效的提交数据' };
  }

  if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    return { ok: false, message: '无效的会话ID' };
  }

  const moves = normalizeGame2048Moves(payload.moves, GAME2048_MAX_MOVES);
  if (!moves.ok) {
    return moves;
  }

  return {
    ok: true,
    sessionId: payload.sessionId.trim(),
    moves: moves.moves,
  };
}

function buildRecord(
  userId: number,
  session: Game2048Session,
  simulation: Game2048SimulationResult,
  pointsEarned: number,
  duration: number,
): Game2048Record {
  return {
    id: nanoid(),
    userId,
    sessionId: session.id,
    gameType: GAME_TYPE,
    score: simulation.score,
    pointsEarned,
    highestTile: simulation.highestTile,
    moves: simulation.movesApplied,
    movesSubmitted: simulation.movesSubmitted,
    won: simulation.won,
    gameOver: simulation.gameOver,
    grid: simulation.grid,
    duration,
    createdAt: Date.now(),
  };
}

async function saveSettlement(
  userId: number,
  session: Game2048Session,
  record: Game2048Record,
  cumulativePointsEarned: number,
  useNativeHotStore: boolean,
): Promise<void> {
  if (useNativeHotStore) {
    await incrementSharedDailyStats(userId, record.score, cumulativePointsEarned);
    await completeNativeGameSettlement(
      record,
      session.id,
      record.score,
      cumulativePointsEarned,
      COOLDOWN_TTL,
    );
    return;
  }

  await incrementSharedDailyStats(userId, record.score, cumulativePointsEarned);
  await kv.lpush(RECORDS_KEY(userId), record);
  await kv.ltrim(RECORDS_KEY(userId), 0, MAX_RECORD_ENTRIES - 1);
  await Promise.all([
    clearLegacySession(session.id, userId),
    kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL }),
  ]);
}

export async function startGame2048(
  userId: number,
): Promise<{ success: boolean; session?: Game2048Session; message?: string }> {
  const useNativeHotStore = await isNativeHotStoreReady();
  const startLockKey = START_LOCK_KEY(userId);
  const startLockToken = await acquireGameLock(startLockKey, START_LOCK_TTL, useNativeHotStore);
  if (!startLockToken) {
    return { success: false, message: '操作过于频繁，请稍后再试' };
  }

  try {
    if (await isInGame2048Cooldown(userId)) {
      const remaining = await getGame2048CooldownRemaining(userId);
      return { success: false, message: `请等待 ${remaining} 秒后再开始游戏` };
    }

    if (useNativeHotStore) {
      const activeSession = await getNativeActiveGameSession<Game2048Session>(userId, GAME_TYPE);
      if (activeSession?.status === 'playing' && Date.now() < activeSession.expiresAt) {
        return { success: false, message: '你已有正在进行的游戏' };
      }
    } else {
      const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
      if (activeSessionId) {
        const activeSession = normalizeSession(await kv.get<Game2048Session>(SESSION_KEY(activeSessionId)));
        if (!activeSession) {
          await kv.del(ACTIVE_SESSION_KEY(userId));
        } else if (activeSession.status === 'playing' && Date.now() < activeSession.expiresAt) {
          return { success: false, message: '你已有正在进行的游戏' };
        } else {
          await clearLegacySession(activeSession.id, userId);
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

export async function cancelGame2048(userId: number): Promise<{ success: boolean; message?: string }> {
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

export async function checkpointGame2048(
  userId: number,
  payload: Game2048CheckpointSubmit,
): Promise<{ success: boolean; session?: Game2048Session; message?: string }> {
  const payloadCheck = validateSubmitPayload(payload);
  if (!payloadCheck.ok) {
    return { success: false, message: payloadCheck.message };
  }

  const useNativeHotStore = await isNativeHotStoreReady();
  const lockKey = CHECKPOINT_LOCK_KEY(payloadCheck.sessionId);
  const lockToken = await acquireGameLock(lockKey, CHECKPOINT_LOCK_TTL, useNativeHotStore);
  if (!lockToken) {
    return { success: false, message: '游戏进度正在同步，请稍后再试' };
  }

  try {
    const session = await loadSessionById(payloadCheck.sessionId, useNativeHotStore);
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
        await clearLegacySession(session.id, userId);
      }
      return { success: false, message: '游戏会话已过期' };
    }

    const simulation = simulateGame2048Segment(session, payloadCheck.moves);
    const nextSession: Game2048Session = {
      ...session,
      checkpointGrid: simulation.grid,
      checkpointScore: simulation.score,
      checkpointMovesApplied: simulation.movesApplied,
      checkpointMovesSubmitted: simulation.movesSubmitted,
    };
    await updateSessionCheckpoint(nextSession, useNativeHotStore);
    return { success: true, session: nextSession };
  } finally {
    await releaseGameLock(lockKey, lockToken, useNativeHotStore);
  }
}

export async function submitGame2048Result(
  userId: number,
  payload: Game2048ResultSubmit,
): Promise<Game2048SubmitResult> {
  const payloadCheck = validateSubmitPayload(payload);
  if (!payloadCheck.ok) {
    return { success: false, message: payloadCheck.message };
  }

  const useNativeHotStore = await isNativeHotStoreReady();
  const settledBeforeLock = await findSettledGame2048Record(userId, payloadCheck.sessionId, useNativeHotStore);
  if (settledBeforeLock) {
    return buildSettledGame2048Result(settledBeforeLock);
  }

  const lockKey = SUBMIT_LOCK_KEY(payloadCheck.sessionId);
  const lockToken = await acquireGameLock(lockKey, SUBMIT_LOCK_TTL, useNativeHotStore);
  if (!lockToken) {
    const settledWhileLocked = await findSettledGame2048Record(userId, payloadCheck.sessionId, useNativeHotStore);
    if (settledWhileLocked) {
      return buildSettledGame2048Result(settledWhileLocked);
    }
    return { success: false, message: '请勿重复提交' };
  }

  try {
    const session = await loadSessionById(payloadCheck.sessionId, useNativeHotStore);
    if (!session) {
      const settledRecord = await findSettledGame2048Record(userId, payloadCheck.sessionId, useNativeHotStore);
      if (settledRecord) {
        return buildSettledGame2048Result(settledRecord);
      }
      return { success: false, message: '游戏会话不存在或已过期' };
    }
    if (session.userId !== userId) {
      return { success: false, message: '会话不属于该用户' };
    }
    if (!await isCurrentActiveSession(userId, session.id, useNativeHotStore)) {
      const settledRecord = await findSettledGame2048Record(userId, session.id, useNativeHotStore);
      if (settledRecord) {
        return buildSettledGame2048Result(settledRecord);
      }
      return { success: false, message: '游戏会话已不是当前活跃局' };
    }
    if (session.status !== 'playing') {
      const settledRecord = await findSettledGame2048Record(userId, session.id, useNativeHotStore);
      if (settledRecord) {
        return buildSettledGame2048Result(settledRecord);
      }
      return { success: false, message: '游戏会话已结束' };
    }
    if (Date.now() > session.expiresAt) {
      if (!useNativeHotStore) {
        await clearLegacySession(session.id, userId);
      }
      return { success: false, message: '游戏会话已过期' };
    }

    const simulation = simulateGame2048Segment(session, payloadCheck.moves);

    const pointReward = calculateGame2048PointReward(simulation.score, simulation.highestTile);
    const dailyPointsLimit = await getDailyPointsLimit();
    const pointsResult = await addGamePointsWithLimit(
      userId,
      pointReward,
      dailyPointsLimit,
      'game_play',
      `2048 得分 ${simulation.score}，最高方块 ${simulation.highestTile}，福利积分 ${pointReward}`,
    );
    const duration = Math.max(0, Math.min(Date.now() - session.startedAt, SESSION_TTL * 1000));
    const record = buildRecord(userId, session, simulation, pointsResult.pointsEarned, duration);
    await saveSettlement(userId, session, record, pointsResult.dailyEarned, useNativeHotStore);

    return { success: true, record, pointsEarned: pointsResult.pointsEarned };
  } finally {
    await releaseGameLock(lockKey, lockToken, useNativeHotStore);
  }
}

export async function settleGame2048Fallback(
  userId: number,
  payload: Game2048ResultSubmit,
): Promise<Game2048SubmitResult> {
  const payloadCheck = validateSubmitPayload(payload);
  if (!payloadCheck.ok) {
    return { success: false, message: payloadCheck.message };
  }

  const useNativeHotStore = await isNativeHotStoreReady();
  const settledBeforeLock = await findSettledGame2048Record(userId, payloadCheck.sessionId, useNativeHotStore);
  if (settledBeforeLock) {
    return buildSettledGame2048Result(settledBeforeLock);
  }

  const lockKey = SUBMIT_LOCK_KEY(payloadCheck.sessionId);
  const lockToken = await acquireGameLock(lockKey, SUBMIT_LOCK_TTL, useNativeHotStore);
  if (!lockToken) {
    const settledWhileLocked = await findSettledGame2048Record(userId, payloadCheck.sessionId, useNativeHotStore);
    if (settledWhileLocked) {
      return buildSettledGame2048Result(settledWhileLocked);
    }
    return { success: false, message: '兜底结算正在处理，请稍后重试' };
  }

  try {
    const session = await loadSessionById(payloadCheck.sessionId, useNativeHotStore);
    if (!session) {
      const settledRecord = await findSettledGame2048Record(userId, payloadCheck.sessionId, useNativeHotStore);
      if (settledRecord) {
        return buildSettledGame2048Result(settledRecord);
      }
      return { success: false, message: '游戏会话不存在或已过期' };
    }
    if (session.userId !== userId) {
      return { success: false, message: '会话不属于该用户' };
    }
    if (!await isCurrentActiveSession(userId, session.id, useNativeHotStore)) {
      const settledRecord = await findSettledGame2048Record(userId, session.id, useNativeHotStore);
      if (settledRecord) {
        return buildSettledGame2048Result(settledRecord);
      }
      return { success: false, message: '游戏会话已不是当前活跃局' };
    }
    if (session.status !== 'playing') {
      const settledRecord = await findSettledGame2048Record(userId, session.id, useNativeHotStore);
      if (settledRecord) {
        return buildSettledGame2048Result(settledRecord);
      }
      return { success: false, message: '游戏会话已结束' };
    }
    if (Date.now() > session.expiresAt) {
      return { success: false, message: '游戏会话已过期' };
    }

    const simulation = simulateGame2048Segment(session, payloadCheck.moves);

    const pointReward = calculateGame2048PointReward(simulation.score, simulation.highestTile);
    const transferResult = await settleGameFallbackTransfer({
      gameKey: '2048',
      sessionId: session.id,
      userId,
      score: simulation.score,
      pointReward,
      gameName: '2048',
      resultLabel: `最高方块 ${simulation.highestTile}，`,
    });
    if (!transferResult.success) {
      return transferResult as GameFallbackTransferFailure;
    }

    const duration = Math.max(0, Math.min(Date.now() - session.startedAt, SESSION_TTL * 1000));
    const record = buildRecord(userId, session, simulation, transferResult.pointsEarned, duration);
    const currentStats = await getDailyStats(userId);
    const cumulativePointsEarned = currentStats.pointsEarned + transferResult.pointsEarned;
    await saveSettlement(userId, session, record, cumulativePointsEarned, useNativeHotStore);

    return { success: true, record, pointsEarned: transferResult.pointsEarned };
  } finally {
    await releaseGameLock(lockKey, lockToken, useNativeHotStore);
  }
}
