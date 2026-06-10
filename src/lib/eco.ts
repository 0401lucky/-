// 环保行动 —— 服务层：KV 状态、用户锁、时间结算、积分对接、对外接口
//
// 经济与防作弊：
// - 垃圾产出在服务端按真实时间结算（见 eco-engine.tickEco），玩家拖拽只回收已累计的垃圾。
// - 积分发放走 addPoints，不占用积分商店展示的每日游戏积分额度。
// - 商店扣分走 deductPoints('exchange')。

import { kv } from '@/lib/d1-kv';
import { acquireGameLock, releaseGameLock } from '@/lib/game-locks';
import { isNativeHotStoreReady } from '@/lib/hot-d1';
import { nanoid } from 'nanoid';
import { getAllUsers } from './kv';
import {
  addPoints,
  deductPoints,
  getUserPoints,
} from '@/lib/points';
import { CHINA_TZ_OFFSET_MS, formatChinaDateKey, getChinaTime, getTodayDateString } from '@/lib/time';
import { getEquippedAchievementForUser } from './user-achievements';
import { getCustomUserProfile } from './user-profile';
import type { PublicAchievement } from './profile-achievements';
import {
  BASE_GRAB_SIZE,
  CLEAR_TRUCK_TRASH,
  ECO_ITEMS,
  ECO_ITEM_KEYS,
  ECO_LUCKY_PRIZE_RATE,
  ECO_NORMAL_SINGLE_PRIZE_RATE,
  ECO_PRIZE_TTL_MS,
  ECO_PRIZES,
  ECO_PRIZE_KEYS,
  ECO_UPGRADES,
  ECO_UPGRADE_KEYS,
  LUCKY_FLASHLIGHT_GENERATIONS,
  MAX_VISIBLE_PRIZES,
  POINT_DIVISOR,
  RECYCLE_GLOVE_USES,
  convertBuffer,
  createInitialEcoState,
  getEcoPrizePrice,
  getEffectiveAutoPerMin,
  getEffectiveSpawnPerMin,
  getGrabSize,
  getPointMultiplier,
  getStorageCap,
  getUpgradeCost,
  getUpgradeLevel,
  getUpgradeMaxLevel,
  normalizeEcoState,
  pruneExpiredVisiblePrizes,
  rollEcoGeneratedPrize,
  type EcoPrizeClaimStats,
  tickEco,
} from '@/lib/eco-engine';
import type {
  EcoItemKey,
  EcoItemView,
  EcoOfflineSummary,
  EcoPrizeKey,
  EcoPrizeView,
  EcoState,
  EcoStatusResponse,
  EcoUpgradeKey,
  EcoUpgradeView,
} from '@/lib/types/eco';

const ECO_STATE_KEY = (userId: number) => `eco:state:${userId}`;
const ECO_LOCK_KEY = (userId: number) => `eco:lock:${userId}`;
const ECO_TRASH_RANK_KEY = (period: EcoTrashRankingPeriod, periodKey: string) => `eco:trash-rank:${period}:${periodKey}`;
const LOCK_TTL_SECONDS = 6;
const LOCK_RETRY_MS = 70;
const LOCK_MAX_RETRIES = 20;
const MAX_DRAGS_PER_REQUEST = 200;
const ECO_PRIZE_CLAIMS_KEY = (dateKey: string) => `eco:prize-claims:${dateKey}`;

export type EcoTrashRankingPeriod = 'daily' | 'weekly' | 'monthly';

export interface EcoTrashLeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  equippedAchievement: PublicAchievement | null;
  trashCleared: number;
}

export interface EcoTrashLeaderboardResult {
  period: EcoTrashRankingPeriod;
  periodKey: string;
  generatedAt: number;
  totalParticipants: number;
  leaderboard: EcoTrashLeaderboardEntry[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface EcoLock {
  token: string;
  useNative: boolean;
}

async function acquireEcoLock(userId: number): Promise<EcoLock | null> {
  const useNative = await isNativeHotStoreReady();
  const key = ECO_LOCK_KEY(userId);
  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt += 1) {
    const token = await acquireGameLock(key, LOCK_TTL_SECONDS, useNative);
    if (token) return { token, useNative };
    await sleep(LOCK_RETRY_MS);
  }
  return null;
}

async function releaseEcoLock(userId: number, lock: EcoLock): Promise<void> {
  try {
    await releaseGameLock(ECO_LOCK_KEY(userId), lock.token, lock.useNative);
  } catch (error) {
    console.error('释放环保行动状态锁失败:', error);
  }
}

async function loadEcoState(userId: number): Promise<EcoState> {
  const existing = await kv.get<EcoState>(ECO_STATE_KEY(userId));
  const now = Date.now();
  if (existing) return normalizeEcoState(existing, now);

  const initial = createInitialEcoState(userId, now);
  initial.points = await getUserPoints(userId);
  await kv.set(ECO_STATE_KEY(userId), initial);
  return initial;
}

async function saveEcoState(state: EcoState): Promise<void> {
  state.updatedAt = Date.now();
  await kv.set(ECO_STATE_KEY(state.userId), state);
}

type EcoLockResult<T> = { ok: true; value: T } | { ok: false; message: string };
type EcoCompensation = () => Promise<void>;

const ecoCompensations = new WeakMap<EcoState, EcoCompensation[]>();

function registerEcoCompensation(state: EcoState, compensation: EcoCompensation): void {
  const stack = ecoCompensations.get(state) ?? [];
  stack.push(compensation);
  ecoCompensations.set(state, stack);
}

async function rollbackEcoCompensations(state: EcoState): Promise<void> {
  const stack = ecoCompensations.get(state);
  ecoCompensations.delete(state);
  if (!stack || stack.length === 0) return;

  for (const compensation of [...stack].reverse()) {
    try {
      await compensation();
    } catch (error) {
      console.error('回滚环保行动积分变更失败:', error);
    }
  }
}

function clearEcoCompensations(state: EcoState): void {
  ecoCompensations.delete(state);
}

async function withEcoLock<T>(
  userId: number,
  fn: (state: EcoState) => Promise<T>,
): Promise<EcoLockResult<T>> {
  const lock = await acquireEcoLock(userId);
  if (!lock) return { ok: false, message: '操作处理中，请稍后重试' };
  try {
    const state = await loadEcoState(userId);
    try {
      const value = await fn(state);
      await saveEcoState(state);
      clearEcoCompensations(state);
      return { ok: true, value };
    } catch (error) {
      await rollbackEcoCompensations(state);
      throw error;
    }
  } finally {
    await releaseEcoLock(userId, lock);
  }
}

function getItemPurchaseCount(state: EcoState, key: EcoItemKey, dateKey: string): number {
  const record = state.itemPurchases[key];
  if (!record || record.date !== dateKey) return 0;
  return Math.max(0, Math.floor(record.count));
}

function incrementItemPurchaseCount(state: EcoState, key: EcoItemKey, dateKey: string): void {
  const count = getItemPurchaseCount(state, key, dateKey);
  state.itemPurchases[key] = { date: dateKey, count: count + 1 };
}

function ensureDailyTrashPoints(state: EcoState, dateKey: string): EcoState['dailyTrashPoints'] {
  if (!state.dailyTrashPoints || state.dailyTrashPoints.date !== dateKey) {
    state.dailyTrashPoints = { date: dateKey, points: 0 };
  }

  state.dailyTrashPoints.points = Math.max(0, Math.floor(state.dailyTrashPoints.points));
  return state.dailyTrashPoints;
}

function addDailyTrashPoints(state: EcoState, points: number): void {
  if (points <= 0) return;
  const record = ensureDailyTrashPoints(state, getTodayDateString());
  record.points += Math.floor(points);
}

function getPreviousDateString(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  return formatChinaDateKey(new Date(date.getTime() - 24 * 60 * 60 * 1000));
}

function getEcoRankingWeekKey(date: Date = new Date()): string {
  const china = getChinaTime(date);
  china.setUTCHours(0, 0, 0, 0);
  const day = china.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  china.setUTCDate(china.getUTCDate() - diffToMonday);
  return formatChinaDateKey(new Date(china.getTime() - CHINA_TZ_OFFSET_MS));
}

function getEcoRankingMonthKey(date: Date = new Date()): string {
  const china = getChinaTime(date);
  const year = china.getUTCFullYear();
  const month = String(china.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getEcoRankingPeriodKey(period: EcoTrashRankingPeriod, date: Date = new Date()): string {
  if (period === 'weekly') return getEcoRankingWeekKey(date);
  if (period === 'monthly') return getEcoRankingMonthKey(date);
  return formatChinaDateKey(date);
}

function getEcoRankingTtlSeconds(period: EcoTrashRankingPeriod): number {
  if (period === 'daily') return 3 * 24 * 60 * 60;
  if (period === 'weekly') return 21 * 24 * 60 * 60;
  return 100 * 24 * 60 * 60;
}

function safeStatNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

async function loadPrizeClaimStats(dateKey: string): Promise<EcoPrizeClaimStats> {
  const raw = await kv.hgetall<Record<string, unknown>>(ECO_PRIZE_CLAIMS_KEY(dateKey));
  const stats: EcoPrizeClaimStats = {};
  for (const key of ECO_PRIZE_KEYS) {
    const count = safeStatNumber(raw?.[key]);
    if (count > 0) stats[key] = count;
  }
  const explicitTotal = safeStatNumber(raw?.total);
  stats.total = explicitTotal > 0
    ? explicitTotal
    : ECO_PRIZE_KEYS.reduce((sum, key) => sum + (stats[key] ?? 0), 0);
  return stats;
}

async function recordPrizeClaim(prizeKey: EcoPrizeKey): Promise<void> {
  const dateKey = getTodayDateString();
  try {
    await Promise.all([
      kv.hincrby(ECO_PRIZE_CLAIMS_KEY(dateKey), prizeKey, 1),
      kv.hincrby(ECO_PRIZE_CLAIMS_KEY(dateKey), 'total', 1),
    ]);
  } catch (error) {
    console.error('记录环保行动奖品领取统计失败:', error);
  }
}

async function recordEcoTrashRanking(userId: number, trash: number): Promise<void> {
  if (trash <= 0) return;
  const now = new Date();
  await Promise.all((['daily', 'weekly', 'monthly'] as EcoTrashRankingPeriod[]).map(async (period) => {
    const periodKey = getEcoRankingPeriodKey(period, now);
    const key = ECO_TRASH_RANK_KEY(period, periodKey);
    await Promise.all([
      kv.zincrby(key, trash, `u:${userId}`),
      kv.expire(key, getEcoRankingTtlSeconds(period)),
    ]);
  }));
}

/** 把回收掉的垃圾转换为积分，同时累计经验与生涯统计。 */
async function creditTrash(
  state: EcoState,
  trash: number,
  reason: string,
): Promise<{ cleared: number; points: number }> {
  if (trash <= 0) return { cleared: 0, points: 0 };

  state.exp += trash;
  state.lifetimeCleared += trash;

  const multiplier = getPointMultiplier(state);
  const { pointsToAward, newBuffer } = convertBuffer(
    state.pointBuffer + trash,
    multiplier,
  );
  state.pointBuffer = newBuffer;

  let points = 0;
  if (pointsToAward > 0) {
    const result = await addPoints(
      state.userId,
      pointsToAward,
      'game_play',
      `环保行动·${reason}`,
    );
    registerEcoCompensation(state, async () => {
      await deductPoints(
        state.userId,
        pointsToAward,
        'game_play',
        `环保行动·${reason}回滚`,
      );
    });
    points = pointsToAward;
    state.points = result.balance;
    state.lifetimePoints += pointsToAward;
    addDailyTrashPoints(state, pointsToAward);
  }

  try {
    await recordEcoTrashRanking(state.userId, trash);
  } catch (error) {
    console.error('更新环保行动垃圾排行榜失败:', error);
  }

  return { cleared: trash, points };
}

/** 时间推进 + 自动回收结算（返回离线/挂机摘要） */
async function advanceEco(
  state: EcoState,
  options: { allowOnlinePrizes?: boolean } = {},
): Promise<EcoOfflineSummary | null> {
  const now = Date.now();
  pruneExpiredVisiblePrizes(state, now);
  let visiblePrizeSlots = state.visiblePrizes.length;
  const tick = tickEco(state, now, {
    rollPrize: options.allowOnlinePrizes
      ? () => {
          if (visiblePrizeSlots >= MAX_VISIBLE_PRIZES) return null;
          const boosted = state.luckyGenerationsRemaining > 0;
          if (boosted) {
            state.luckyGenerationsRemaining = Math.max(0, state.luckyGenerationsRemaining - 1);
          }
          const multiplier = boosted ? ECO_LUCKY_PRIZE_RATE / ECO_NORMAL_SINGLE_PRIZE_RATE : 1;
          const prizeKey = rollEcoGeneratedPrize(Math.random, multiplier);
          if (prizeKey) visiblePrizeSlots += 1;
          return prizeKey;
        }
      : undefined,
  });
  for (const prizeKey of tick.prizeKeys) {
    state.visiblePrizes.push({
      id: nanoid(),
      key: prizeKey,
      createdAt: now,
    });
  }
  if (tick.autoCollected <= 0) return null;
  const credited = await creditTrash(state, tick.autoCollected, '自动回收');
  if (credited.cleared <= 0) return null;
  return { cleared: credited.cleared, points: credited.points, elapsedMs: tick.elapsedMs };
}

function summarizeUpgrades(state: EcoState): EcoUpgradeView[] {
  return ECO_UPGRADE_KEYS.map((key) => {
    const def = ECO_UPGRADES[key];
    const level = getUpgradeLevel(state, key);
    const maxLevel = getUpgradeMaxLevel(key);
    const maxed = level >= maxLevel;
    return {
      key,
      name: def.name,
      emoji: def.emoji,
      desc: def.desc,
      level,
      maxLevel,
      nextCost: getUpgradeCost(key, level),
      currentEffectLabel: def.effectLabel(level),
      nextEffectLabel: maxed ? null : def.effectLabel(level + 1),
      maxed,
    };
  });
}

function summarizeItems(state: EcoState, now: number): EcoItemView[] {
  void now;
  const dateKey = getTodayDateString();
  return ECO_ITEM_KEYS.map((key) => {
    const def = ECO_ITEMS[key];
    const purchasedToday = getItemPurchaseCount(state, key, dateKey);
    return {
      key,
      name: def.name,
      emoji: def.emoji,
      desc: def.desc,
      cost: def.cost,
      dailyLimit: def.dailyLimit,
      purchasedToday,
      remainingToday: Math.max(0, def.dailyLimit - purchasedToday),
    };
  });
}

async function summarizePrizes(state: EcoState): Promise<EcoPrizeView[]> {
  const now = new Date();
  const today = formatChinaDateKey(now);
  const yesterday = formatChinaDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const priceDates = Array.from({ length: 7 }, (_, index) => (
    formatChinaDateKey(new Date(now.getTime() - (6 - index) * 24 * 60 * 60 * 1000))
  ));
  const priceStats = new Map(
    await Promise.all(priceDates.map(async (date) => [
      date,
      await loadPrizeClaimStats(getPreviousDateString(date)),
    ] as const)),
  );
  return ECO_PRIZE_KEYS.map((key) => {
    const def = ECO_PRIZES[key];
    const todayPrice = getEcoPrizePrice(key, today, priceStats.get(today));
    const yesterdayPrice = getEcoPrizePrice(key, yesterday, priceStats.get(yesterday));
    const priceHistory = priceDates.map((date) => ({
      date,
      price: getEcoPrizePrice(key, date, priceStats.get(date)),
    }));
    return {
      key,
      name: def.name,
      emoji: def.emoji,
      imageSrc: def.imageSrc,
      inventory: state.inventory[key] ?? 0,
      todayPrice,
      yesterdayPrice,
      change: todayPrice - yesterdayPrice,
      weekChange: todayPrice - (priceHistory[0]?.price ?? todayPrice),
      priceHistory,
      minPrice: def.minPrice,
      maxPrice: def.maxPrice,
      spawnRate: def.spawnRate,
    };
  });
}

async function buildEcoStatus(
  state: EcoState,
  offline: EcoOfflineSummary | null,
): Promise<EcoStatusResponse> {
  const now = Date.now();
  pruneExpiredVisiblePrizes(state, now);
  const balance = await getUserPoints(state.userId);
  const todayDateKey = getTodayDateString();
  const dailyTrashPoints = ensureDailyTrashPoints(state, todayDateKey);
  state.points = balance;

  return {
    serverNow: now,
    points: balance,
    pending: state.pending,
    pendingTotal: state.pending + state.visiblePrizes.length,
    storageCap: getStorageCap(state),
    pointBuffer: state.pointBuffer,
    pointDivisor: POINT_DIVISOR,
    pointMultiplier: getPointMultiplier(state),
    spawnPerMin: getEffectiveSpawnPerMin(state, now),
    autoPerMin: getEffectiveAutoPerMin(state, now),
    grabSize: getGrabSize(state),
    exp: state.exp,
    lifetimeCleared: state.lifetimeCleared,
    lifetimePoints: state.lifetimePoints,
    todayTrashPoints: dailyTrashPoints.points,
    todayTrashPointsDate: todayDateKey,
    upgrades: summarizeUpgrades(state),
    items: summarizeItems(state, now),
    prizes: await summarizePrizes(state),
    visiblePrizes: state.visiblePrizes.map((prize) => ({
      id: prize.id,
      key: prize.key,
      name: ECO_PRIZES[prize.key].name,
      emoji: ECO_PRIZES[prize.key].emoji,
      imageSrc: ECO_PRIZES[prize.key].imageSrc,
      expiresAt: prize.createdAt + ECO_PRIZE_TTL_MS,
    })),
    luckyGenerationsRemaining: state.luckyGenerationsRemaining,
    gloveUsesRemaining: state.gloveUsesRemaining,
    offline,
  };
}

// ───────────────────────── 对外接口 ─────────────────────────

interface EcoStatusOptions {
  allowOnlinePrizes?: boolean;
}

/** 读取状态（含时间推进与离线自动回收结算） */
export async function getEcoStatus(
  userId: number,
  options: EcoStatusOptions = {},
): Promise<EcoStatusResponse> {
  const result = await withEcoLock(userId, async (state) => {
    const offline = await advanceEco(state, { allowOnlinePrizes: options.allowOnlinePrizes === true });
    return buildEcoStatus(state, offline);
  });
  if (result.ok) return result.value;

  // 取锁失败时退化为只读快照（不结算），保证页面可用
  const state = await loadEcoState(userId);
  return buildEcoStatus(state, null);
}

export interface EcoActionResult {
  ok: boolean;
  message?: string;
  cleared?: number;
  pointsEarned?: number;
  data?: EcoStatusResponse;
}

/** 回收垃圾：drags = 本次拖拽次数，服务端按 grabSize 与 pending 钳制 */
export async function collectEcoTrash(userId: number, drags: number): Promise<EcoActionResult> {
  const safeDrags = Math.floor(drags);
  if (!Number.isFinite(safeDrags) || safeDrags <= 0) {
    return { ok: false, message: '无效的回收次数' };
  }
  const boundedDrags = Math.min(safeDrags, MAX_DRAGS_PER_REQUEST);

  const result = await withEcoLock(userId, async (state) => {
    const offline = await advanceEco(state, { allowOnlinePrizes: true });
    const boostedDrags = Math.min(boundedDrags, Math.max(0, Math.floor(state.gloveUsesRemaining)));
    const want = boundedDrags * BASE_GRAB_SIZE + boostedDrags;
    const collectable = Math.min(state.pending, want);
    state.pending = Math.max(0, state.pending - collectable);
    if (boostedDrags > 0) {
      state.gloveUsesRemaining = Math.max(0, state.gloveUsesRemaining - boostedDrags);
    }
    const credited = await creditTrash(state, collectable, '手动回收');
    const status = await buildEcoStatus(state, offline);
    return { cleared: credited.cleared, points: credited.points, status };
  });

  if (!result.ok) return { ok: false, message: result.message };
  return {
    ok: true,
    cleared: result.value.cleared,
    pointsEarned: result.value.points,
    data: result.value.status,
  };
}

/** 购买/升级商店项 */
export async function buyEcoUpgrade(userId: number, key: EcoUpgradeKey): Promise<EcoActionResult> {
  if (!ECO_UPGRADE_KEYS.includes(key)) {
    return { ok: false, message: '未知升级项' };
  }

  const result = await withEcoLock(userId, async (state) => {
    await advanceEco(state, { allowOnlinePrizes: true });
    const level = getUpgradeLevel(state, key);
    const cost = getUpgradeCost(key, level);
    if (cost === null) {
      return { ok: false as const, message: '该项已满级' };
    }
    const def = ECO_UPGRADES[key];
    const deducted = await deductPoints(
      userId,
      cost,
      'exchange',
      `环保行动升级·${def.name} Lv${level + 1}`,
    );
    if (!deducted.success) {
      return { ok: false as const, message: deducted.message ?? '积分不足' };
    }
    registerEcoCompensation(state, async () => {
      await addPoints(
        userId,
        cost,
        'exchange_refund',
        `环保行动升级·${def.name} Lv${level + 1}回滚`,
      );
    });
    state.points = deducted.balance;
    state.upgrades[key] = level + 1;
    const status = await buildEcoStatus(state, null);
    return { ok: true as const, status };
  });

  if (!result.ok) return { ok: false, message: result.message };
  if (!result.value.ok) return { ok: false, message: result.value.message };
  return { ok: true, data: result.value.status };
}

/** 购买并立即使用道具 */
export async function buyEcoItem(userId: number, key: EcoItemKey): Promise<EcoActionResult> {
  if (!ECO_ITEM_KEYS.includes(key)) {
    return { ok: false, message: '未知道具' };
  }

  const result = await withEcoLock(userId, async (state) => {
    await advanceEco(state, { allowOnlinePrizes: true });
    const def = ECO_ITEMS[key];
    const dateKey = getTodayDateString();
    const purchasedToday = getItemPurchaseCount(state, key, dateKey);

    if (purchasedToday >= def.dailyLimit) {
      return { ok: false as const, message: '今日购买次数已用完' };
    }

    const deducted = await deductPoints(userId, def.cost, 'exchange', `环保行动道具·${def.name}`);
    if (!deducted.success) {
      return { ok: false as const, message: deducted.message ?? '积分不足' };
    }
    registerEcoCompensation(state, async () => {
      await addPoints(
        userId,
        def.cost,
        'exchange_refund',
        `环保行动道具·${def.name}回滚`,
      );
    });
    state.points = deducted.balance;

    incrementItemPurchaseCount(state, key, dateKey);

    if (key === 'clear_truck') {
      const visibleSlots = state.visiblePrizes.length;
      const basePending = Math.min(
        Math.max(0, Math.floor(state.pending)),
        Math.max(0, getStorageCap(state) - visibleSlots),
      );
      const availableSlots = Math.max(
        0,
        getStorageCap(state) - visibleSlots - basePending,
      );
      state.pending = basePending + Math.min(CLEAR_TRUCK_TRASH, availableSlots);
    } else if (key === 'lucky_flashlight') {
      state.luckyGenerationsRemaining += LUCKY_FLASHLIGHT_GENERATIONS;
    } else if (key === 'recycle_glove') {
      state.gloveUsesRemaining += RECYCLE_GLOVE_USES;
    }

    const status = await buildEcoStatus(state, null);
    return { ok: true as const, status };
  });

  if (!result.ok) return { ok: false, message: result.message };
  if (!result.value.ok) return { ok: false, message: result.value.message };
  return { ok: true, data: result.value.status };
}

export interface EcoClaimPrizeResult extends EcoActionResult {
  prizeKey?: EcoPrizeKey;
}

export async function claimEcoPrize(userId: number, prizeId: string): Promise<EcoClaimPrizeResult> {
  if (!prizeId || typeof prizeId !== 'string') {
    return { ok: false, message: '参数错误' };
  }

  const result = await withEcoLock(userId, async (state) => {
    await advanceEco(state, { allowOnlinePrizes: true });
    const index = state.visiblePrizes.findIndex((prize) => prize.id === prizeId);
    if (index < 0) {
      return { ok: false as const, message: '奖品已不存在' };
    }

    const [prize] = state.visiblePrizes.splice(index, 1);
    state.inventory[prize.key] = (state.inventory[prize.key] ?? 0) + 1;
    state.lifetimePrizeClaims += 1;
    state.lifetimePrizeClaimCounts[prize.key] = (state.lifetimePrizeClaimCounts[prize.key] ?? 0) + 1;
    await recordPrizeClaim(prize.key);
    const status = await buildEcoStatus(state, null);
    return { ok: true as const, prizeKey: prize.key, status };
  });

  if (!result.ok) return { ok: false, message: result.message };
  if (!result.value.ok) return { ok: false, message: result.value.message };
  return {
    ok: true,
    prizeKey: result.value.prizeKey,
    data: result.value.status,
  };
}

export interface EcoSellPrizeResult extends EcoActionResult {
  prizeKey?: EcoPrizeKey;
  quantitySold?: number;
  price?: number;
  pointsEarned?: number;
}

export async function sellEcoPrize(
  userId: number,
  key: EcoPrizeKey,
  quantity = 1,
): Promise<EcoSellPrizeResult> {
  if (!ECO_PRIZE_KEYS.includes(key)) {
    return { ok: false, message: '未知奖品' };
  }

  const safeQuantity = Math.floor(quantity);
  if (!Number.isFinite(safeQuantity) || safeQuantity <= 0) {
    return { ok: false, message: '出售数量无效' };
  }

  const result = await withEcoLock(userId, async (state) => {
    await advanceEco(state, { allowOnlinePrizes: true });
    const owned = state.inventory[key] ?? 0;
    if (owned < safeQuantity) {
      return { ok: false as const, message: '背包库存不足' };
    }

    const dateKey = getTodayDateString();
    const price = getEcoPrizePrice(key, dateKey, await loadPrizeClaimStats(getPreviousDateString(dateKey)));
    const total = price * safeQuantity;

    const awarded = await addPoints(
      userId,
      total,
      'game_play',
      `环保行动出售·${ECO_PRIZES[key].name}`,
    );
    registerEcoCompensation(state, async () => {
      await deductPoints(
        userId,
        total,
        'game_play',
        `环保行动出售·${ECO_PRIZES[key].name}回滚`,
      );
    });
    state.inventory[key] = Math.max(0, owned - safeQuantity);
    state.points = awarded.balance;
    state.lifetimePoints += total;
    const status = await buildEcoStatus(state, null);
    return {
      ok: true as const,
      status,
      quantitySold: safeQuantity,
      price,
      pointsEarned: total,
    };
  });

  if (!result.ok) return { ok: false, message: result.message };
  if (!result.value.ok) return { ok: false, message: result.value.message };
  return {
    ok: true,
    prizeKey: key,
    quantitySold: result.value.quantitySold,
    price: result.value.price,
    pointsEarned: result.value.pointsEarned,
    data: result.value.status,
  };
}

export interface EcoProgressSummary {
  lifetimeCleared: number;
  lifetimePoints: number;
  lifetimePrizeClaims: number;
  lifetimePhotoClaims: number;
}

/** 供个人中心 / 游戏中心战绩聚合使用 */
export async function getEcoProgressSummary(userId: number): Promise<EcoProgressSummary | null> {
  const existing = await kv.get<EcoState>(ECO_STATE_KEY(userId));
  if (!existing) return null;
  const state = normalizeEcoState(existing, Date.now());
  return {
    lifetimeCleared: state.lifetimeCleared,
    lifetimePoints: state.lifetimePoints,
    lifetimePrizeClaims: state.lifetimePrizeClaims,
    lifetimePhotoClaims: state.lifetimePrizeClaimCounts.photo ?? 0,
  };
}

function normalizeEcoRankingUserId(member: unknown): number {
  const raw = String(member ?? '').replace(/^u:/, '');
  const userId = Number(raw);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : 0;
}

export async function getEcoTrashLeaderboard(
  period: EcoTrashRankingPeriod = 'daily',
  limit = 20,
): Promise<EcoTrashLeaderboardResult> {
  const safePeriod: EcoTrashRankingPeriod =
    period === 'weekly' || period === 'monthly' ? period : 'daily';
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const periodKey = getEcoRankingPeriodKey(safePeriod);
  const rankingKey = ECO_TRASH_RANK_KEY(safePeriod, periodKey);
  const raw = await kv.zrange<string | number>(
    rankingKey,
    0,
    -1,
    { rev: true, withScores: true },
  );
  const totalParticipants = await kv.zcard(rankingKey);

  const pairs: Array<{ userId: number; trashCleared: number }> = [];
  for (let index = 0; index < raw.length; index += 2) {
    const userId = normalizeEcoRankingUserId(raw[index]);
    const score = Number(raw[index + 1]);
    if (userId <= 0 || !Number.isFinite(score) || score <= 0) continue;
    pairs.push({ userId, trashCleared: Math.floor(score) });
  }

  const users = await getAllUsers();
  const usernameById = new Map(
    users
      .map((user) => ({ id: Number(user.id), username: user.username }))
      .filter((user) => Number.isSafeInteger(user.id) && user.id > 0)
      .map((user) => [user.id, user.username || `#${user.id}`] as const),
  );

  const sortedPairs = pairs
    .sort((a, b) => {
      if (b.trashCleared !== a.trashCleared) return b.trashCleared - a.trashCleared;
      return a.userId - b.userId;
    })
    .slice(0, safeLimit);

  const leaderboard = await Promise.all(
    sortedPairs.map(async ({ userId, trashCleared }, index): Promise<EcoTrashLeaderboardEntry> => {
      const [profile, equippedAchievement] = await Promise.all([
        getCustomUserProfile(userId),
        getEquippedAchievementForUser(userId),
      ]);
      return {
        rank: index + 1,
        userId,
        username: usernameById.get(userId) ?? `#${userId}`,
        displayName: profile.displayName ?? null,
        avatarUrl: profile.avatarUrl ?? null,
        equippedAchievement,
        trashCleared,
      };
    }),
  );

  return {
    period: safePeriod,
    periodKey,
    generatedAt: Date.now(),
    totalParticipants,
    leaderboard,
  };
}
