// src/lib/tower.ts - 爬塔游戏后端逻辑

import { randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { kv } from '@/lib/d1-kv';
import { addGamePointsWithLimit } from './points';
import { getDailyPointsLimit } from './config';
import { getDailyStats, incrementSharedDailyStats } from './daily-stats';
import {
  acquireNativeLock,
  cancelNativeGameSession,
  completeNativeGameSettlement,
  createNativeGameSession,
  getNativeActiveGameSession,
  getNativeGameCooldownRemaining,
  getNativeGameSession,
  isNativeHotStoreReady,
  listNativeGameRecords,
  releaseNativeLock,
} from './hot-d1';
import {
  buildGenerateFloorOptions,
  buildTowerFloorView,
  calculateTowerScore,
  createInitialTowerPlayerState,
  createTowerRng,
  generateFloor,
  resolveTowerStep,
  simulateTowerGame,
  type ResolvedLaneContent,
  type TowerDifficulty,
  type TowerFloor,
  type TowerFloorView,
  type TowerPlayerState,
  type TowerStepOutcome,
} from './tower-engine';
import type { BlessingType, CurseType } from './tower-engine';
import type { GameSessionStatus } from './types/game';

export { getDailyStats };

const GAME_TYPE = 'tower' as const;

const SESSION_TTL = 30 * 60;
const COOLDOWN_TTL = 5;
const MIN_GAME_DURATION = 5_000;
const MAX_RECORD_ENTRIES = 50;
const MAX_CHOICES = 500;
const STEP_LOCK_TTL = 3;

const VALID_DIFFICULTIES: TowerDifficulty[] = ['normal', 'hard', 'hell'];

const SESSION_KEY = (sessionId: string) => `tower:session:${sessionId}`;
const ACTIVE_SESSION_KEY = (userId: number) => `tower:active:${userId}`;
const RECORDS_KEY = (userId: number) => `tower:records:${userId}`;
const COOLDOWN_KEY = (userId: number) => `tower:cooldown:${userId}`;
const SUBMIT_LOCK_KEY = (sessionId: string) => `tower:submit:${sessionId}`;
const STEP_LOCK_KEY = (sessionId: string) => `tower:step:${sessionId}`;

export interface TowerGameSession {
  id: string;
  userId: number;
  gameType: typeof GAME_TYPE;
  seed: string;
  startedAt: number;
  expiresAt: number;
  status: GameSessionStatus;
  difficulty?: TowerDifficulty;
  choices: number[];
  floorNumber: number;
  currentFloor: TowerFloor;
  player: TowerPlayerState;
  gameOver: boolean;
  deathFloor?: number;
  deathLane?: number;
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

export interface TowerGameStepPayload {
  sessionId: string;
  laneIndex: number;
}

export interface TowerGameResultSubmit {
  sessionId: string;
}

export interface TowerSessionView {
  sessionId: string;
  startedAt: number;
  expiresAt: number;
  difficulty?: TowerDifficulty;
  floorNumber: number;
  choicesCount: number;
  currentFloor: TowerFloorView | null;
  player: TowerPlayerState;
  gameOver: boolean;
}

export interface TowerStepView {
  selectedLane: ResolvedLaneContent;
  gameOver: boolean;
  blockedByShield: boolean;
  bossDefeated: boolean;
  newBuff?: string;
  newBlessing?: TowerStepOutcome['newBlessing'];
  newCurse?: TowerStepOutcome['newCurse'];
  expiredBlessings: BlessingType[];
  expiredCurses: CurseType[];
}

function generateSeed(): string {
  return randomBytes(16).toString('hex');
}

function getSessionTtlSeconds(expiresAt: number): number {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
}

function normalizeChoices(choices: unknown): number[] {
  if (!Array.isArray(choices)) {
    return [];
  }
  return choices.filter((choice): choice is number => Number.isInteger(choice) && choice >= 0);
}

function normalizeTowerSession(raw: unknown): TowerGameSession | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const session = raw as Partial<TowerGameSession>;
  if (
    typeof session.id !== 'string' ||
    typeof session.userId !== 'number' ||
    typeof session.seed !== 'string' ||
    typeof session.startedAt !== 'number' ||
    typeof session.expiresAt !== 'number' ||
    typeof session.status !== 'string'
  ) {
    return null;
  }

  if (!session.player || !session.currentFloor) {
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
    ...(session.difficulty !== undefined ? { difficulty: session.difficulty } : {}),
    choices: normalizeChoices(session.choices),
    floorNumber: Number.isInteger(session.floorNumber) ? Number(session.floorNumber) : normalizeChoices(session.choices).length + 1,
    currentFloor: session.currentFloor as TowerFloor,
    player: session.player as TowerPlayerState,
    gameOver: session.gameOver === true,
    ...(Number.isInteger(session.deathFloor) ? { deathFloor: Number(session.deathFloor) } : {}),
    ...(Number.isInteger(session.deathLane) ? { deathLane: Number(session.deathLane) } : {}),
  };
}

async function saveTowerSession(session: TowerGameSession, useNativeHotStore: boolean): Promise<void> {
  if (useNativeHotStore) {
    await createNativeGameSession(session);
    return;
  }

  const ttlSeconds = getSessionTtlSeconds(session.expiresAt);
  await kv.set(SESSION_KEY(session.id), session, { ex: ttlSeconds });
  await kv.set(ACTIVE_SESSION_KEY(session.userId), session.id, { ex: ttlSeconds });
}

async function deleteTowerSession(sessionId: string, userId: number, useNativeHotStore: boolean): Promise<void> {
  if (useNativeHotStore) {
    return;
  }

  await Promise.all([
    kv.del(SESSION_KEY(sessionId)),
    kv.del(ACTIVE_SESSION_KEY(userId)),
  ]);
}

async function loadTowerSessionById(
  sessionId: string,
  useNativeHotStore: boolean,
): Promise<TowerGameSession | null> {
  const rawSession = useNativeHotStore
    ? await getNativeGameSession<TowerGameSession>(sessionId)
    : await kv.get<TowerGameSession>(SESSION_KEY(sessionId));

  return normalizeTowerSession(rawSession);
}

function buildSessionView(session: TowerGameSession): TowerSessionView {
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    difficulty: session.difficulty,
    floorNumber: session.floorNumber,
    choicesCount: session.choices.length,
    currentFloor: session.gameOver ? null : buildTowerFloorView(session.currentFloor, session.player),
    player: session.player,
    gameOver: session.gameOver,
  };
}

function buildStepView(outcome: TowerStepOutcome): TowerStepView {
  return {
    selectedLane: outcome.selectedLane,
    gameOver: outcome.gameOver,
    blockedByShield: outcome.blockedByShield,
    bossDefeated: outcome.bossDefeated,
    ...(outcome.newBuff ? { newBuff: outcome.newBuff } : {}),
    ...(outcome.newBlessing ? { newBlessing: outcome.newBlessing } : {}),
    ...(outcome.newCurse ? { newCurse: outcome.newCurse } : {}),
    expiredBlessings: outcome.expiredBlessings,
    expiredCurses: outcome.expiredCurses,
  };
}

function buildInitialSession(userId: number, difficulty?: TowerDifficulty): TowerGameSession {
  const now = Date.now();
  const seed = generateSeed();
  const player = createInitialTowerPlayerState();
  const rng = createTowerRng(seed);
  const currentFloor = generateFloor(
    rng,
    1,
    player.power,
    player.buffs,
    buildGenerateFloorOptions(difficulty, player),
  );

  return {
    id: nanoid(),
    userId,
    gameType: GAME_TYPE,
    seed,
    startedAt: now,
    expiresAt: now + SESSION_TTL * 1000,
    status: 'playing',
    ...(difficulty !== undefined ? { difficulty } : {}),
    choices: [],
    floorNumber: 1,
    currentFloor,
    player,
    gameOver: false,
  };
}

function validateDifficulty(difficulty?: TowerDifficulty): boolean {
  return difficulty === undefined || VALID_DIFFICULTIES.includes(difficulty);
}

type RehydratedActiveRuntime =
  | { ok: true; rng: ReturnType<typeof createTowerRng>; player: TowerPlayerState; currentFloor: TowerFloor }
  | { ok: false; message: string };

function rehydrateActiveRuntime(session: TowerGameSession): RehydratedActiveRuntime {
  const rng = createTowerRng(session.seed);
  let player = createInitialTowerPlayerState();

  for (let index = 0; index < session.choices.length; index += 1) {
    const floorNumber = index + 1;
    const floor = generateFloor(
      rng,
      floorNumber,
      player.power,
      player.buffs,
      buildGenerateFloorOptions(session.difficulty, player),
    );
    const step = resolveTowerStep(rng, floor, session.choices[index]!, player, session.difficulty);
    if (!step.ok) {
      return step;
    }
    if (step.outcome.gameOver) {
      return { ok: false, message: '游戏会话已结束' };
    }
    player = step.outcome.state;
  }

  const currentFloor = generateFloor(
    rng,
    session.choices.length + 1,
    player.power,
    player.buffs,
    buildGenerateFloorOptions(session.difficulty, player),
  );

  return { ok: true, rng, player, currentFloor };
}

export async function isInCooldown(userId: number): Promise<boolean> {
  if (await isNativeHotStoreReady()) {
    return (await getNativeGameCooldownRemaining(userId, GAME_TYPE)) > 0;
  }
  return (await kv.get(COOLDOWN_KEY(userId))) !== null;
}

export async function getCooldownRemaining(userId: number): Promise<number> {
  if (await isNativeHotStoreReady()) {
    return getNativeGameCooldownRemaining(userId, GAME_TYPE);
  }
  const ttl = await kv.ttl(COOLDOWN_KEY(userId));
  return ttl > 0 ? ttl : 0;
}

export async function getTowerRecords(userId: number, limit: number = 20): Promise<TowerGameRecord[]> {
  if (await isNativeHotStoreReady()) {
    return listNativeGameRecords<TowerGameRecord>(userId, GAME_TYPE, limit);
  }
  const records = await kv.lrange<TowerGameRecord>(RECORDS_KEY(userId), 0, limit - 1);
  return records ?? [];
}

export async function getActiveTowerSession(userId: number): Promise<TowerGameSession | null> {
  const useNativeHotStore = await isNativeHotStoreReady();
  if (useNativeHotStore) {
    const session = await getNativeActiveGameSession<TowerGameSession>(userId, GAME_TYPE);
    return normalizeTowerSession(session);
  }

  const activeSessionId = await kv.get<string>(ACTIVE_SESSION_KEY(userId));
  if (!activeSessionId) {
    return null;
  }

  const session = normalizeTowerSession(await kv.get<TowerGameSession>(SESSION_KEY(activeSessionId)));
  if (!session) {
    await kv.del(ACTIVE_SESSION_KEY(userId));
    return null;
  }

  if (Date.now() > session.expiresAt) {
    await deleteTowerSession(session.id, userId, false);
    return null;
  }

  return session;
}

export function buildTowerSessionView(session: TowerGameSession): TowerSessionView {
  return buildSessionView(session);
}

export async function startTowerGame(
  userId: number,
  difficulty?: TowerDifficulty,
): Promise<{ success: boolean; session?: TowerGameSession; message?: string }> {
  const useNativeHotStore = await isNativeHotStoreReady();

  if (!validateDifficulty(difficulty)) {
    return { success: false, message: '无效的难度选择' };
  }

  if (await isInCooldown(userId)) {
    const remaining = await getCooldownRemaining(userId);
    return { success: false, message: `请等待 ${remaining} 秒后再开始游戏` };
  }

  const activeSession = await getActiveTowerSession(userId);
  if (activeSession?.status === 'playing' && Date.now() < activeSession.expiresAt) {
    return { success: false, message: '你已有正在进行的游戏' };
  }

  if (activeSession) {
    await deleteTowerSession(activeSession.id, userId, useNativeHotStore);
  }

  const session = buildInitialSession(userId, difficulty);
  await saveTowerSession(session, useNativeHotStore);

  return { success: true, session };
}

export async function cancelTowerGame(userId: number): Promise<{ success: boolean; message?: string }> {
  if (await isNativeHotStoreReady()) {
    const cancelled = await cancelNativeGameSession(userId, GAME_TYPE, COOLDOWN_TTL);
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

function validateStepPayload(payload: TowerGameStepPayload): { ok: true } | { ok: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '无效的请求数据' };
  }
  if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    return { ok: false, message: '无效的会话ID' };
  }
  if (!Number.isInteger(payload.laneIndex) || payload.laneIndex < 0) {
    return { ok: false, message: '无效的通道索引' };
  }
  return { ok: true };
}

function validateSubmitPayload(payload: TowerGameResultSubmit): { ok: true } | { ok: false; message: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '无效的提交数据' };
  }
  if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') {
    return { ok: false, message: '无效的会话ID' };
  }
  return { ok: true };
}

export async function stepTowerGame(
  userId: number,
  payload: TowerGameStepPayload,
): Promise<{ success: boolean; session?: TowerSessionView; outcome?: TowerStepView; message?: string }> {
  const useNativeHotStore = await isNativeHotStoreReady();
  const payloadCheck = validateStepPayload(payload);
  if (!payloadCheck.ok) {
    return { success: false, message: payloadCheck.message };
  }

  const lockKey = STEP_LOCK_KEY(payload.sessionId);
  const lockAcquired = useNativeHotStore
    ? await acquireNativeLock(lockKey, '1', STEP_LOCK_TTL)
    : await kv.set(lockKey, '1', { ex: STEP_LOCK_TTL, nx: true });
  if (lockAcquired !== true && lockAcquired !== 'OK') {
    return { success: false, message: '操作过于频繁，请稍后再试' };
  }

  try {
    const session = await loadTowerSessionById(payload.sessionId, useNativeHotStore);
    if (!session) {
      return { success: false, message: '游戏会话不存在或已过期' };
    }
    if (session.userId !== userId) {
      return { success: false, message: '会话不属于该用户' };
    }
    if (session.status !== 'playing') {
      return { success: false, message: '游戏会话已结束' };
    }
    if (Date.now() > session.expiresAt) {
      await deleteTowerSession(session.id, session.userId, useNativeHotStore);
      return { success: false, message: '游戏会话已过期' };
    }
    if (session.gameOver) {
      return { success: false, message: '游戏已结束，请先结算本局' };
    }
    if (session.choices.length >= MAX_CHOICES) {
      return { success: false, message: '选择步数过多' };
    }

    const runtime = rehydrateActiveRuntime(session);
    if (!runtime.ok) {
      return { success: false, message: runtime.message };
    }

    const step = resolveTowerStep(
      runtime.rng,
      runtime.currentFloor,
      payload.laneIndex,
      runtime.player,
      session.difficulty,
    );
    if (!step.ok) {
      return { success: false, message: step.message };
    }

    const nextChoices = [...session.choices, payload.laneIndex];
    const nextSession: TowerGameSession = {
      ...session,
      choices: nextChoices,
      player: step.outcome.state,
      gameOver: step.outcome.gameOver,
      ...(step.outcome.gameOver ? {
        deathFloor: runtime.currentFloor.floor,
        deathLane: payload.laneIndex,
      } : {}),
      floorNumber: step.outcome.gameOver ? runtime.currentFloor.floor : nextChoices.length + 1,
      currentFloor: step.outcome.gameOver
        ? runtime.currentFloor
        : generateFloor(
            runtime.rng,
            nextChoices.length + 1,
            step.outcome.state.power,
            step.outcome.state.buffs,
            buildGenerateFloorOptions(session.difficulty, step.outcome.state),
          ),
    };

    await saveTowerSession(nextSession, useNativeHotStore);

    return {
      success: true,
      session: buildSessionView(nextSession),
      outcome: buildStepView(step.outcome),
    };
  } finally {
    if (useNativeHotStore) {
      await releaseNativeLock(lockKey, '1');
    } else {
      await kv.del(lockKey);
    }
  }
}

export async function submitTowerResult(
  userId: number,
  payload: TowerGameResultSubmit,
): Promise<{ success: boolean; record?: TowerGameRecord; pointsEarned?: number; message?: string }> {
  const useNativeHotStore = await isNativeHotStoreReady();
  const payloadCheck = validateSubmitPayload(payload);
  if (!payloadCheck.ok) {
    return { success: false, message: payloadCheck.message };
  }

  const lockKey = SUBMIT_LOCK_KEY(payload.sessionId);
  const lockAcquired = useNativeHotStore
    ? await acquireNativeLock(lockKey, '1', SESSION_TTL)
    : await kv.set(lockKey, '1', { ex: SESSION_TTL, nx: true });
  if (lockAcquired !== true && lockAcquired !== 'OK') {
    return { success: false, message: '请勿重复提交' };
  }

  const session = await loadTowerSessionById(payload.sessionId, useNativeHotStore);
  if (!session) {
    if (useNativeHotStore) {
      await releaseNativeLock(lockKey, '1');
    } else {
      await kv.del(lockKey);
    }
    return { success: false, message: '游戏会话不存在或已过期' };
  }
  if (session.userId !== userId) {
    if (useNativeHotStore) {
      await releaseNativeLock(lockKey, '1');
    } else {
      await kv.del(lockKey);
    }
    return { success: false, message: '会话不属于该用户' };
  }
  if (session.status !== 'playing') {
    if (useNativeHotStore) {
      await releaseNativeLock(lockKey, '1');
    } else {
      await kv.del(lockKey);
    }
    return { success: false, message: '游戏会话已结束' };
  }
  if (Date.now() > session.expiresAt) {
    await deleteTowerSession(session.id, session.userId, useNativeHotStore);
    if (useNativeHotStore) {
      await releaseNativeLock(lockKey, '1');
    } else {
      await kv.del(lockKey);
    }
    return { success: false, message: '游戏会话已过期' };
  }

  const serverDuration = Date.now() - session.startedAt;
  if (serverDuration < MIN_GAME_DURATION) {
    if (useNativeHotStore) {
      await releaseNativeLock(lockKey, '1');
    } else {
      await kv.del(lockKey);
    }
    return { success: false, message: '游戏时长过短' };
  }

  const sim = simulateTowerGame(session.seed, session.choices, session.difficulty);
  if (!sim.ok) {
    if (useNativeHotStore) {
      await releaseNativeLock(lockKey, '1');
    } else {
      await kv.del(lockKey);
    }
    return { success: false, message: sim.message };
  }

  const scoreBreakdown = calculateTowerScore(
    sim.floorsClimbed,
    sim.bossesDefeated,
    sim.maxCombo,
    sim.usedShield,
    session.difficulty,
  );
  const score = scoreBreakdown.total;
  const dailyPointsLimit = await getDailyPointsLimit();
  const diffLabel = session.difficulty ? ` [${session.difficulty}]` : '';
  const pointsResult = await addGamePointsWithLimit(
    userId,
    score,
    dailyPointsLimit,
    'game_play',
    `爬塔挑战${diffLabel} ${sim.floorsClimbed}层 Boss×${sim.bossesDefeated} Combo×${sim.maxCombo} 得分 ${score}`,
  );

  const record: TowerGameRecord = {
    id: nanoid(),
    userId,
    sessionId: session.id,
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
    ...(session.difficulty !== undefined ? {
      difficulty: session.difficulty,
      difficultyMultiplier: scoreBreakdown.difficultyMultiplier,
    } : {}),
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
      kv.del(SESSION_KEY(session.id)),
      kv.del(ACTIVE_SESSION_KEY(userId)),
      kv.set(COOLDOWN_KEY(userId), '1', { ex: COOLDOWN_TTL }),
      incrementSharedDailyStats(userId, score, pointsResult.dailyEarned),
      kv.lpush(RECORDS_KEY(userId), record).then(() => kv.ltrim(RECORDS_KEY(userId), 0, MAX_RECORD_ENTRIES - 1)),
    ]);
  }

  return { success: true, record, pointsEarned: pointsResult.pointsEarned };
}
