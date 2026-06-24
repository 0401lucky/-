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
  applyPointsDelta,
  deductPoints,
  getUserPoints,
} from '@/lib/points';
import { CHINA_TZ_OFFSET_MS, formatChinaDateKey, getChinaTime, getTodayDateString } from '@/lib/time';
import { forceEquipAchievement, getEquippedAchievementForUser, grantUserAchievement } from './user-achievements';
import { getCustomUserProfile, getPublicSessionUserProfile } from './user-profile';
import type { PublicAchievement } from './profile-achievements';
import {
  BASE_GRAB_SIZE,
  CLEAR_TRUCK_TRASH,
  ECO_GLOBAL_PRIZE_LIMITS,
  ECO_ITEMS,
  ECO_ITEM_KEYS,
  ECO_LUCKY_PRIZE_RATE,
  ECO_NORMAL_SINGLE_PRIZE_RATE,
  ECO_PRIZE_TTL_MS,
  ECO_PRIZES,
  ECO_PRIZE_KEYS,
  ECO_THEFT_CHECK_INTERVAL_MS,
  ECO_THEFT_PROTECTION_MS,
  ECO_UPGRADES,
  ECO_UPGRADE_KEYS,
  LUCKY_FLASHLIGHT_GENERATIONS,
  MAX_VISIBLE_PRIZES,
  POINT_DIVISOR,
  RECYCLE_GLOVE_USES,
  convertBuffer,
  createEmptyPrizeInventory,
  createInitialEcoState,
  calculateEcoTheftCaughtProbability,
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
  pruneExpiredVisiblePrizesDetailed,
  rollEcoGeneratedPrize,
  type EcoPrizeClaimStats,
  type EcoPrizeSpawnRates,
  tickEco,
} from '@/lib/eco-engine';
import type {
  EcoItemKey,
  EcoItemView,
  EcoOfflineSummary,
  EcoPublicPrizeEntry,
  EcoPrizeKey,
  EcoPrizeInventory,
  EcoPrizeLot,
  EcoPrizeView,
  EcoState,
  EcoStatusResponse,
  EcoUpgradeKey,
  EcoUpgradeView,
} from '@/lib/types/eco';

const ECO_STATE_KEY = (userId: number) => `eco:state:${userId}`;
const ECO_LOCK_KEY = (userId: number) => `eco:lock:${userId}`;
const ECO_TRASH_RANK_KEY = (period: EcoTrashRankingPeriod, periodKey: string) => `eco:trash-rank:${period}:${periodKey}`;
const ECO_GLOBAL_PRIZE_STOCK_KEY = 'eco:global-prize-stock';
const ECO_GLOBAL_PRIZE_LOCK_KEY = 'eco:global-prize-stock:lock';
const ECO_PUBLIC_PRIZES_KEY = 'eco:public-prizes';
const ECO_THEFTS_KEY = 'eco:thefts';
const ECO_ADMIN_PRIZE_RATES_KEY = 'eco:admin:prize-rates';
const ECO_MANUAL_TRASH_KEY = (dateKey: string) => `eco:manual-trash:${dateKey}`;
const ECO_THEFT_INVESTIGATION_LOCK_KEY = 'eco:theft-investigation:lock';
const LOCK_TTL_SECONDS = 6;
const THEFT_INVESTIGATION_LOCK_TTL_SECONDS = 25;
const LOCK_RETRY_MS = 70;
const LOCK_MAX_RETRIES = 20;
const MAX_DRAGS_PER_REQUEST = 200;
const ECO_PRIZE_CLAIMS_KEY = (dateKey: string) => `eco:prize-claims:${dateKey}`;
const THEFT_BLACK_MARKET_DELAY_MS = 24 * 60 * 60 * 1000;
const THIEF_FORCED_ACHIEVEMENT_MS = 10 * 60 * 60 * 1000;
const ECO_MANUAL_TRASH_TTL_SECONDS = 45 * 24 * 60 * 60;

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

export interface EcoAdminPrizeRateView {
  key: EcoPrizeKey;
  name: string;
  emoji: string;
  imageSrc: string;
  defaultRate: number;
  currentRate: number;
  globalLimit: number;
}

export interface EcoAdminPrizeLotView {
  id: string;
  acquiredAt: number;
  source: EcoPrizeLot['source'];
  stolenFromUserId: number | null;
  stolenAt: number | null;
}

export interface EcoAdminPrizeHolderView {
  userId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  lifetimeCount: number;
  currentCount: number;
  stolenCount: number;
  lots: EcoAdminPrizeLotView[];
}

export interface EcoAdminPrizeSummary extends EcoAdminPrizeRateView {
  totalLifetimeClaims: number;
  totalCurrentInventory: number;
  holderCount: number;
  holders: EcoAdminPrizeHolderView[];
}

export interface EcoAdminTheftView {
  id: string;
  key: EcoPrizeKey;
  prizeName: string;
  prizeEmoji: string;
  originalUserId: number;
  originalUsername: string;
  originalDisplayName: string | null;
  thiefUserId: number;
  thiefUsername: string;
  thiefDisplayName: string | null;
  message: string;
  stolenAt: number;
  resolvedAt: number | null;
  outcome: EcoTheftRecord['outcome'];
}

export interface EcoAdminManualTrashRow {
  userId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  total: number;
  days: Record<string, number>;
}

export interface EcoAdminManualTrashResult {
  days: string[];
  rows: EcoAdminManualTrashRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface EcoAdminOverview {
  generatedAt: number;
  prizes: EcoAdminPrizeSummary[];
  thefts: EcoAdminTheftView[];
  manualTrash: EcoAdminManualTrashResult;
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

interface EcoTheftRecord {
  id: string;
  key: EcoPrizeKey;
  originalUserId: number;
  thiefUserId: number;
  publicEntryId: string;
  originalLotId: string;
  thiefLotId: string;
  stolenAt: number;
  nextCheckAt: number;
  blackMarketAvailableAt: number;
  caughtCountBeforeTheft?: number;
  message: string;
  resolvedAt?: number | null;
  outcome?: 'caught' | 'escaped' | null;
}

export interface EcoTheftInvestigationRunResult {
  checked: number;
  caught: number;
  escaped: number;
  rescheduled: number;
  skipped: number;
  locked: boolean;
}

async function acquireEcoGlobalPrizeLock(): Promise<EcoLock | null> {
  const useNative = await isNativeHotStoreReady();
  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt += 1) {
    const token = await acquireGameLock(ECO_GLOBAL_PRIZE_LOCK_KEY, LOCK_TTL_SECONDS, useNative);
    if (token) return { token, useNative };
    await sleep(LOCK_RETRY_MS);
  }
  return null;
}

async function releaseEcoGlobalPrizeLock(lock: EcoLock): Promise<void> {
  try {
    await releaseGameLock(ECO_GLOBAL_PRIZE_LOCK_KEY, lock.token, lock.useNative);
  } catch (error) {
    console.error('释放环保行动全服奖品库存锁失败:', error);
  }
}

async function withEcoGlobalPrizeLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = await acquireEcoGlobalPrizeLock();
  if (!lock) throw new Error('奖品库存处理中，请稍后重试');
  try {
    return await fn();
  } finally {
    await releaseEcoGlobalPrizeLock(lock);
  }
}

async function acquireEcoTheftInvestigationLock(): Promise<EcoLock | null> {
  const useNative = await isNativeHotStoreReady();
  const token = await acquireGameLock(
    ECO_THEFT_INVESTIGATION_LOCK_KEY,
    THEFT_INVESTIGATION_LOCK_TTL_SECONDS,
    useNative,
  );
  return token ? { token, useNative } : null;
}

async function releaseEcoTheftInvestigationLock(lock: EcoLock): Promise<void> {
  try {
    await releaseGameLock(ECO_THEFT_INVESTIGATION_LOCK_KEY, lock.token, lock.useNative);
  } catch (error) {
    console.error('释放环保行动偷盗追查锁失败:', error);
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

function cloneEcoStateSnapshot(state: EcoState): EcoState {
  return JSON.parse(JSON.stringify(state)) as EcoState;
}

async function restoreEcoStateSnapshot(state: EcoState): Promise<void> {
  await kv.set(ECO_STATE_KEY(state.userId), cloneEcoStateSnapshot(state));
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

async function withTwoEcoLocks<T>(
  userA: number,
  userB: number,
  fn: (stateA: EcoState, stateB: EcoState) => Promise<T>,
): Promise<EcoLockResult<T>> {
  if (userA === userB) return { ok: false, message: '不能对自己操作' };
  const [firstUser, secondUser] = [userA, userB].sort((a, b) => a - b);
  const firstLock = await acquireEcoLock(firstUser);
  if (!firstLock) return { ok: false, message: '操作处理中，请稍后重试' };
  let secondLock: EcoLock | null = null;
  try {
    secondLock = await acquireEcoLock(secondUser);
    if (!secondLock) return { ok: false, message: '操作处理中，请稍后重试' };
    const firstState = await loadEcoState(firstUser);
    const secondState = await loadEcoState(secondUser);
    const firstSnapshot = cloneEcoStateSnapshot(firstState);
    const secondSnapshot = cloneEcoStateSnapshot(secondState);
    const stateA = userA === firstUser ? firstState : secondState;
    const stateB = userB === firstUser ? firstState : secondState;
    try {
      const value = await fn(stateA, stateB);
      await Promise.all([saveEcoState(firstState), saveEcoState(secondState)]);
      clearEcoCompensations(firstState);
      clearEcoCompensations(secondState);
      return { ok: true, value };
    } catch (error) {
      await Promise.all([
        rollbackEcoCompensations(firstState),
        rollbackEcoCompensations(secondState),
      ]);
      await Promise.allSettled([
        restoreEcoStateSnapshot(firstSnapshot),
        restoreEcoStateSnapshot(secondSnapshot),
      ]);
      throw error;
    }
  } finally {
    if (secondLock) await releaseEcoLock(secondUser, secondLock);
    await releaseEcoLock(firstUser, firstLock);
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

function safeRateNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

async function loadEcoPrizeRatesConfig(): Promise<Record<EcoPrizeKey, number>> {
  const raw = await kv.get<EcoPrizeSpawnRates>(ECO_ADMIN_PRIZE_RATES_KEY);
  return ECO_PRIZE_KEYS.reduce((rates, key) => {
    rates[key] = safeRateNumber(raw?.[key], ECO_PRIZES[key].spawnRate);
    return rates;
  }, {} as Record<EcoPrizeKey, number>);
}

function buildEcoPrizeRateViews(rates: Record<EcoPrizeKey, number>): EcoAdminPrizeRateView[] {
  return ECO_PRIZE_KEYS.map((key) => {
    const def = ECO_PRIZES[key];
    return {
      key,
      name: def.name,
      emoji: def.emoji,
      imageSrc: def.imageSrc,
      defaultRate: def.spawnRate,
      currentRate: rates[key],
      globalLimit: ECO_GLOBAL_PRIZE_LIMITS[key],
    };
  });
}

export async function getEcoPrizeRateSettings(): Promise<EcoAdminPrizeRateView[]> {
  const rates = await loadEcoPrizeRatesConfig();
  return buildEcoPrizeRateViews(rates);
}

export async function updateEcoPrizeRateSettings(input: unknown): Promise<EcoAdminPrizeRateView[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('请提交奖品概率配置');
  }

  const current = await loadEcoPrizeRatesConfig();
  const next = { ...current };
  const patch = input as Record<string, unknown>;

  for (const key of ECO_PRIZE_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      throw new Error(`${ECO_PRIZES[key].name}概率必须在 0% 到 100% 之间`);
    }
    next[key] = parsed;
  }

  const totalRate = ECO_PRIZE_KEYS.reduce((sum, key) => sum + next[key], 0);
  if (totalRate > 1) {
    throw new Error('5 个奖品概率合计不能超过 100%');
  }

  await kv.set(ECO_ADMIN_PRIZE_RATES_KEY, next);
  return buildEcoPrizeRateViews(next);
}

function getNextChinaSixAt(timestamp: number): number {
  const china = new Date(timestamp + CHINA_TZ_OFFSET_MS);
  const target = new Date(china);
  target.setUTCDate(china.getUTCDate() + 1);
  target.setUTCHours(6, 0, 0, 0);
  return target.getTime() - CHINA_TZ_OFFSET_MS;
}

function getEcoPrizeLotTotal(state: EcoState, key: EcoPrizeKey): number {
  return state.prizeLots.filter((lot) => lot.key === key).length;
}

function getLegacyPrizeInventory(state: EcoState, key: EcoPrizeKey): number {
  return Math.max(0, (state.inventory[key] ?? 0) - getEcoPrizeLotTotal(state, key));
}

function getSellableLotCount(state: EcoState, key: EcoPrizeKey, now: number): number {
  return state.prizeLots.filter((lot) => (
    lot.key === key
    && lot.source !== 'stolen'
    && lot.availableAt <= now
  )).length;
}

function getPublicMerchantLotCount(state: EcoState, key: EcoPrizeKey, now: number): number {
  return state.prizeLots.filter((lot) => (
    lot.key === key
    && lot.publicEntryId
    && lot.source !== 'stolen'
    && (lot.merchantAvailableAt ?? Number.POSITIVE_INFINITY) <= now
  )).length;
}

function getBlackMarketLotCount(state: EcoState, key: EcoPrizeKey, now: number): number {
  return state.prizeLots.filter((lot) => (
    lot.key === key
    && lot.source === 'stolen'
    && (lot.blackMarketAvailableAt ?? Number.POSITIVE_INFINITY) <= now
  )).length;
}

async function loadPublicPrizeEntries(): Promise<EcoPublicPrizeEntry[]> {
  const raw = await kv.get<unknown>(ECO_PUBLIC_PRIZES_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is EcoPublicPrizeEntry => (
    item
    && typeof item === 'object'
    && typeof (item as EcoPublicPrizeEntry).id === 'string'
    && (ECO_PRIZE_KEYS as string[]).includes((item as EcoPublicPrizeEntry).key)
    && Number.isSafeInteger((item as EcoPublicPrizeEntry).ownerUserId)
  )).slice(-100);
}

async function savePublicPrizeEntries(entries: EcoPublicPrizeEntry[]): Promise<void> {
  await kv.set(ECO_PUBLIC_PRIZES_KEY, entries.slice(-100));
}

function clonePublicPrizeEntries(entries: EcoPublicPrizeEntry[]): EcoPublicPrizeEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

function registerPublicPrizeEntriesRollback(state: EcoState, previousEntries: EcoPublicPrizeEntry[]): void {
  const snapshot = clonePublicPrizeEntries(previousEntries);
  registerEcoCompensation(state, async () => {
    await withEcoGlobalPrizeLock(async () => {
      await savePublicPrizeEntries(snapshot);
    });
  });
}

async function loadTheftRecords(): Promise<EcoTheftRecord[]> {
  const raw = await kv.get<unknown>(ECO_THEFTS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is EcoTheftRecord => (
    item
    && typeof item === 'object'
    && typeof (item as EcoTheftRecord).id === 'string'
    && (ECO_PRIZE_KEYS as string[]).includes((item as EcoTheftRecord).key)
    && Number.isSafeInteger((item as EcoTheftRecord).originalUserId)
    && Number.isSafeInteger((item as EcoTheftRecord).thiefUserId)
  )).slice(-100);
}

async function saveTheftRecords(records: EcoTheftRecord[]): Promise<void> {
  await kv.set(ECO_THEFTS_KEY, records.slice(-100));
}

function cloneTheftRecords(records: EcoTheftRecord[]): EcoTheftRecord[] {
  return records.map((record) => ({ ...record }));
}

function registerTheftRecordsRollback(state: EcoState, previousRecords: EcoTheftRecord[]): void {
  const snapshot = cloneTheftRecords(previousRecords);
  registerEcoCompensation(state, async () => {
    await withEcoGlobalPrizeLock(async () => {
      await saveTheftRecords(snapshot);
    });
  });
}

function hasActiveEcoTheft(records: EcoTheftRecord[], thiefUserId: number): boolean {
  return records.some((record) => (
    record.thiefUserId === thiefUserId
    && !record.resolvedAt
  ));
}

function getPublicEntryTheftCaughtCount(entry: Pick<EcoPublicPrizeEntry, 'theftCaughtCount'>): number {
  const count = entry.theftCaughtCount;
  return Number.isFinite(count) ? Math.max(0, Math.floor(count as number)) : 0;
}

function getPublicEntryStealProtectedUntil(
  entry: Pick<EcoPublicPrizeEntry, 'stealProtectedUntil'>,
): number | null {
  const protectedUntil = entry.stealProtectedUntil;
  return Number.isFinite(protectedUntil) ? Math.max(0, Math.floor(protectedUntil as number)) : null;
}

function isPublicEntryStealProtected(entry: EcoPublicPrizeEntry, now: number): boolean {
  const protectedUntil = getPublicEntryStealProtectedUntil(entry);
  return protectedUntil !== null && protectedUntil > now;
}

function formatStealProtectionReason(protectedUntil: number, now: number): string {
  const remainingMinutes = Math.max(1, Math.ceil((protectedUntil - now) / (60 * 1000)));
  if (remainingMinutes >= 60) {
    return `保护中 ${Math.ceil(remainingMinutes / 60)}小时`;
  }
  return `保护中 ${remainingMinutes}分钟`;
}

async function getEcoUsernames(userIds: number[]): Promise<Map<number, string>> {
  const uniqueIds = Array.from(new Set(
    userIds.filter((userId) => Number.isSafeInteger(userId) && userId > 0),
  ));
  const usernames = new Map<number, string>();
  if (uniqueIds.length === 0) return usernames;
  const idSet = new Set(uniqueIds);

  try {
    const users = await getAllUsers();
    for (const user of users) {
      const id = Number(user.id);
      if (idSet.has(id) && user.username) {
        usernames.set(id, user.username);
      }
    }
  } catch {
    // 全量用户索引可能缺失，下面按 user:{id} 单独兜底。
  }

  await Promise.all(uniqueIds.map(async (userId) => {
    if (usernames.has(userId)) return;
    try {
      const user = await kv.get<{ id?: number; username?: string }>(`user:${userId}`);
      if (typeof user?.username === 'string' && user.username.length > 0) {
        usernames.set(userId, user.username);
      }
    } catch {
      // 单个用户资料缺失时保留后续展示降级。
    }
  }));

  return usernames;
}

async function getEcoUserName(userId: number): Promise<string> {
  const usernames = await getEcoUsernames([userId]);
  const username = usernames.get(userId);
  if (username) return username;
  return `#${userId}`;
}

async function loadGlobalPrizeStock(): Promise<EcoPrizeInventory> {
  const raw = await kv.hgetall<Record<string, unknown>>(ECO_GLOBAL_PRIZE_STOCK_KEY);
  const stock = createEmptyPrizeInventory();
  for (const key of ECO_PRIZE_KEYS) {
    stock[key] = safeStatNumber(raw?.[key]);
  }
  return stock;
}

async function incrementGlobalPrizeStock(
  key: EcoPrizeKey,
  delta: number,
): Promise<{ next: number; appliedDelta: number }> {
  if (delta === 0) {
    const stock = await loadGlobalPrizeStock();
    return { next: stock[key] ?? 0, appliedDelta: 0 };
  }

  const next = await kv.hincrby(ECO_GLOBAL_PRIZE_STOCK_KEY, key, delta);
  if (next >= 0) return { next, appliedDelta: delta };

  // 旧库存出售或历史异常数据不允许把新规则库存扣成负数。
  await kv.hincrby(ECO_GLOBAL_PRIZE_STOCK_KEY, key, -next);
  return { next: 0, appliedDelta: delta - next };
}

async function adjustGlobalPrizeStockWithRollback(
  state: EcoState,
  key: EcoPrizeKey,
  delta: number,
): Promise<number> {
  if (delta === 0) return 0;
  const { next, appliedDelta } = await incrementGlobalPrizeStock(key, delta);
  if (appliedDelta === 0) return next;
  registerEcoCompensation(state, async () => {
    await withEcoGlobalPrizeLock(async () => {
      await incrementGlobalPrizeStock(key, -appliedDelta);
    });
  });
  return next;
}

function addPrizeCount(target: EcoPrizeInventory, key: EcoPrizeKey, delta: number): void {
  target[key] = Math.max(0, (target[key] ?? 0) + delta);
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

async function recordEcoManualTrash(userId: number, trash: number): Promise<void> {
  const count = Math.max(0, Math.floor(trash));
  if (count <= 0) return;
  const dateKey = getTodayDateString();
  const key = ECO_MANUAL_TRASH_KEY(dateKey);
  try {
    await kv.hincrby(key, String(userId), count);
    await kv.expire(key, ECO_MANUAL_TRASH_TTL_SECONDS);
  } catch (error) {
    console.error('记录环保行动手捡垃圾统计失败:', error);
  }
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
  const expiredPrizes = pruneExpiredVisiblePrizesDetailed(state, now);
  const expiredLimitedCounts = createEmptyPrizeInventory();
  for (const prize of expiredPrizes) {
    if (prize.limited === true) {
      addPrizeCount(expiredLimitedCounts, prize.key, 1);
    }
  }
  const hasExpiredLimitedPrizes = ECO_PRIZE_KEYS.some((key) => expiredLimitedCounts[key] > 0);
  const prizeRates = options.allowOnlinePrizes ? await loadEcoPrizeRatesConfig() : null;

  let tick: ReturnType<typeof tickEco> | null = null;
  if (options.allowOnlinePrizes || hasExpiredLimitedPrizes) {
    await withEcoGlobalPrizeLock(async () => {
      const stock = await loadGlobalPrizeStock();
      for (const key of ECO_PRIZE_KEYS) {
        const expiredCount = expiredLimitedCounts[key];
        if (expiredCount > 0) {
          stock[key] = await adjustGlobalPrizeStockWithRollback(state, key, -expiredCount);
        }
      }

      let visiblePrizeSlots = state.visiblePrizes.length;
      const reservedCounts = createEmptyPrizeInventory();
      tick = tickEco(state, now, {
        rollPrize: options.allowOnlinePrizes
          ? () => {
              if (visiblePrizeSlots >= MAX_VISIBLE_PRIZES) return null;
              const boosted = state.luckyGenerationsRemaining > 0;
              if (boosted) {
                state.luckyGenerationsRemaining = Math.max(0, state.luckyGenerationsRemaining - 1);
              }
              const multiplier = boosted ? ECO_LUCKY_PRIZE_RATE / ECO_NORMAL_SINGLE_PRIZE_RATE : 1;
              const prizeKey = rollEcoGeneratedPrize(Math.random, multiplier, prizeRates ?? undefined);
              if (!prizeKey) return null;
              if ((stock[prizeKey] ?? 0) >= ECO_GLOBAL_PRIZE_LIMITS[prizeKey]) {
                return null;
              }
              stock[prizeKey] += 1;
              addPrizeCount(reservedCounts, prizeKey, 1);
              visiblePrizeSlots += 1;
              return prizeKey;
            }
          : undefined,
      });

      for (const key of ECO_PRIZE_KEYS) {
        const reservedCount = reservedCounts[key];
        if (reservedCount > 0) {
          await adjustGlobalPrizeStockWithRollback(state, key, reservedCount);
        }
      }
    });
  } else {
    tick = tickEco(state, now);
  }
  if (!tick) {
    throw new Error('环保行动结算失败');
  }

  for (const prizeKey of tick.prizeKeys) {
    state.visiblePrizes.push({
      id: nanoid(),
      key: prizeKey,
      createdAt: now,
      limited: true,
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
  const nowMs = now.getTime();
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
  const prizeRates = await loadEcoPrizeRatesConfig();
  return ECO_PRIZE_KEYS.map((key) => {
    const def = ECO_PRIZES[key];
    const todayPrice = getEcoPrizePrice(key, today, priceStats.get(today));
    const yesterdayPrice = getEcoPrizePrice(key, yesterday, priceStats.get(yesterday));
    const priceHistory = priceDates.map((date) => {
      const stats = priceStats.get(date);
      return {
        date,
        price: getEcoPrizePrice(key, date, stats),
        previousDayClaimCount: stats?.[key] ?? 0,
        previousDayTotalClaims: stats?.total ?? 0,
      };
    });
    return {
      key,
      name: def.name,
      emoji: def.emoji,
      imageSrc: def.imageSrc,
      inventory: state.inventory[key] ?? 0,
      sellableInventory: getLegacyPrizeInventory(state, key) + getSellableLotCount(state, key, nowMs),
      lockedInventory: Math.max(
        0,
        (state.inventory[key] ?? 0)
          - getLegacyPrizeInventory(state, key)
          - getSellableLotCount(state, key, nowMs)
          - getBlackMarketLotCount(state, key, nowMs),
      ),
      publicInventory: state.prizeLots.filter((lot) => lot.key === key && lot.publicEntryId && lot.source !== 'stolen').length,
      stolenInventory: state.prizeLots.filter((lot) => lot.key === key && lot.source === 'stolen').length,
      merchantAvailableCount: getPublicMerchantLotCount(state, key, nowMs),
      merchantPrice: Math.floor(todayPrice * 1.2),
      blackMarketAvailableCount: getBlackMarketLotCount(state, key, nowMs),
      todayPrice,
      yesterdayPrice,
      change: todayPrice - yesterdayPrice,
      weekChange: todayPrice - (priceHistory[0]?.price ?? todayPrice),
      priceHistory,
      minPrice: def.minPrice,
      maxPrice: def.maxPrice,
      spawnRate: prizeRates[key],
    };
  });
}

async function summarizePublicBoard(viewerUserId: number): Promise<EcoStatusResponse['publicBoard']> {
  const now = Date.now();
  const [entries, stock, thefts] = await Promise.all([
    loadPublicPrizeEntries(),
    loadGlobalPrizeStock(),
    loadTheftRecords(),
  ]);
  const remaining = createEmptyPrizeInventory();
  for (const key of ECO_PRIZE_KEYS) {
    remaining[key] = Math.max(0, ECO_GLOBAL_PRIZE_LIMITS[key] - (stock[key] ?? 0));
  }
  const visibleEntries = entries
    .filter((entry) => entry.status === 'listed' || entry.status === 'stolen')
    .slice(-30)
    .reverse();
  const publicUserIds = Array.from(new Set(
    visibleEntries.map((entry) => entry.ownerUserId),
  ));
  const profiles = new Map<number, Awaited<ReturnType<typeof getCustomUserProfile>>>();
  const sessionProfiles = new Map<number, Awaited<ReturnType<typeof getPublicSessionUserProfile>>>();
  const [, , usernames] = await Promise.all([
    Promise.all(publicUserIds.map(async (userId) => {
      try {
        profiles.set(userId, await getCustomUserProfile(userId));
      } catch {
        profiles.set(userId, {});
      }
    })),
    Promise.all(publicUserIds.map(async (userId) => {
      try {
        sessionProfiles.set(userId, await getPublicSessionUserProfile(userId));
      } catch {
        sessionProfiles.set(userId, {});
      }
    })),
    getEcoUsernames(publicUserIds),
  ]);

  return {
    remaining,
    entries: visibleEntries
      .map((entry) => {
        const profile = profiles.get(entry.ownerUserId);
        const sessionProfile = sessionProfiles.get(entry.ownerUserId);
        const ownerUsername = usernames.get(entry.ownerUserId)
          || sessionProfile?.username
          || (entry.ownerName && !entry.ownerName.startsWith('#') ? entry.ownerName : `#${entry.ownerUserId}`);
        const ownerDisplayName = profile?.displayName ?? null;
        const ownerName = profile?.displayName
          || sessionProfile?.displayName
          || sessionProfile?.username
          || usernames.get(entry.ownerUserId)
          || entry.ownerName;
        const isOwnPrize = entry.ownerUserId === viewerUserId;
        const viewerHasActiveTheft = hasActiveEcoTheft(thefts, viewerUserId);
        const protectedUntil = getPublicEntryStealProtectedUntil(entry);
        const stealProtected = protectedUntil !== null && protectedUntil > now;
        const theftCaughtCount = getPublicEntryTheftCaughtCount(entry);
        const canSteal = entry.status === 'listed' && !isOwnPrize && !viewerHasActiveTheft && !stealProtected;
        const stealDisabledReason = entry.status !== 'listed'
          ? '追查中'
          : isOwnPrize
            ? '自己的奖品'
            : viewerHasActiveTheft
              ? '已有偷盗'
              : stealProtected
                ? formatStealProtectionReason(protectedUntil, now)
                : null;
        return {
          id: entry.id,
          key: entry.key,
          name: ECO_PRIZES[entry.key].name,
          emoji: ECO_PRIZES[entry.key].emoji,
          imageSrc: ECO_PRIZES[entry.key].imageSrc,
          ownerUserId: entry.ownerUserId,
          ownerName,
          ownerUsername,
          ownerDisplayName,
          ownerAvatarUrl: profile?.avatarUrl ?? null,
          merchantAvailableAt: entry.merchantAvailableAt,
          status: entry.status,
          canSteal,
          stealDisabledReason,
          stealProtectedUntil: protectedUntil,
          theftCaughtCount,
          thiefUserId: null,
          thiefName: null,
          thiefAvatarUrl: null,
          theftMessage: entry.theftMessage ?? null,
          stolenAt: entry.stolenAt ?? null,
        };
      }),
  };
}

async function buildEcoStatus(
  state: EcoState,
  offline: EcoOfflineSummary | null,
): Promise<EcoStatusResponse> {
  const now = Date.now();
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
    publicBoard: await summarizePublicBoard(state.userId),
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

type EcoAdminUserRecord = Awaited<ReturnType<typeof getAllUsers>>[number];

function getRecentChinaDateKeys(days = 7): string[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  return Array.from({ length: days }, (_, index) => (
    formatChinaDateKey(new Date(now - (days - 1 - index) * dayMs))
  ));
}

function getAdminUsername(usernames: Map<number, string>, userId: number): string {
  return usernames.get(userId) ?? `#${userId}`;
}

async function loadAdminProfiles(
  userIds: number[],
): Promise<Map<number, Awaited<ReturnType<typeof getCustomUserProfile>>>> {
  const uniqueIds = Array.from(new Set(
    userIds.filter((userId) => Number.isSafeInteger(userId) && userId > 0),
  ));
  const profiles = new Map<number, Awaited<ReturnType<typeof getCustomUserProfile>>>();
  await Promise.all(uniqueIds.map(async (userId) => {
    try {
      profiles.set(userId, await getCustomUserProfile(userId));
    } catch {
      profiles.set(userId, {});
    }
  }));
  return profiles;
}

function buildAllUsernames(users: EcoAdminUserRecord[]): Map<number, string> {
  return new Map(
    users
      .map((user) => ({ id: Number(user.id), username: user.username }))
      .filter((user) => Number.isSafeInteger(user.id) && user.id > 0)
      .map((user) => [user.id, user.username || `#${user.id}`] as const),
  );
}

async function buildEcoAdminPrizeSummaries(users: EcoAdminUserRecord[]): Promise<EcoAdminPrizeSummary[]> {
  const rates = await loadEcoPrizeRatesConfig();
  const rateViews = buildEcoPrizeRateViews(rates);
  const usernameById = buildAllUsernames(users);
  const validUsers = users.filter((user) => Number.isSafeInteger(Number(user.id)) && Number(user.id) > 0);
  const stateKeys = validUsers.map((user) => ECO_STATE_KEY(Number(user.id)));
  const rawStates = stateKeys.length > 0 ? await kv.mget<EcoState>(...stateKeys) : [];
  const now = Date.now();

  type HolderDraft = Omit<EcoAdminPrizeHolderView, 'username' | 'displayName' | 'avatarUrl'>;
  const holderDrafts = ECO_PRIZE_KEYS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {} as Record<EcoPrizeKey, HolderDraft[]>);

  rawStates.forEach((raw, index) => {
    if (!raw) return;
    const userId = Number(validUsers[index]?.id);
    if (!Number.isSafeInteger(userId) || userId <= 0) return;
    const state = normalizeEcoState(raw, now);

    for (const key of ECO_PRIZE_KEYS) {
      const currentCount = safeStatNumber(state.inventory[key]);
      const lifetimeCount = Math.max(
        safeStatNumber(state.lifetimePrizeClaimCounts[key]),
        currentCount,
      );
      const lots = state.prizeLots
        .filter((lot) => lot.key === key)
        .sort((a, b) => b.acquiredAt - a.acquiredAt)
        .map((lot) => ({
          id: lot.id,
          acquiredAt: lot.acquiredAt,
          source: lot.source,
          stolenFromUserId: lot.stolenFromUserId ?? null,
          stolenAt: lot.stolenAt ?? null,
        }));
      if (lifetimeCount <= 0 && currentCount <= 0 && lots.length === 0) continue;

      holderDrafts[key].push({
        userId,
        lifetimeCount,
        currentCount,
        stolenCount: lots.filter((lot) => lot.source === 'stolen').length,
        lots,
      });
    }
  });

  const holderUserIds = ECO_PRIZE_KEYS.flatMap((key) => holderDrafts[key].map((holder) => holder.userId));
  const profiles = await loadAdminProfiles(holderUserIds);

  return rateViews.map((rateView) => {
    const holders = holderDrafts[rateView.key]
      .sort((a, b) => {
        if (b.lifetimeCount !== a.lifetimeCount) return b.lifetimeCount - a.lifetimeCount;
        if (b.currentCount !== a.currentCount) return b.currentCount - a.currentCount;
        return a.userId - b.userId;
      })
      .map((holder) => {
        const profile = profiles.get(holder.userId);
        return {
          ...holder,
          username: getAdminUsername(usernameById, holder.userId),
          displayName: profile?.displayName ?? null,
          avatarUrl: profile?.avatarUrl ?? null,
        };
      });

    return {
      ...rateView,
      totalLifetimeClaims: holders.reduce((sum, holder) => sum + holder.lifetimeCount, 0),
      totalCurrentInventory: holders.reduce((sum, holder) => sum + holder.currentCount, 0),
      holderCount: holders.length,
      holders,
    };
  });
}

async function buildEcoAdminTheftViews(): Promise<EcoAdminTheftView[]> {
  const records = (await loadTheftRecords()).sort((a, b) => b.stolenAt - a.stolenAt);
  const userIds = records.flatMap((record) => [record.originalUserId, record.thiefUserId]);
  const [usernames, profiles] = await Promise.all([
    getEcoUsernames(userIds),
    loadAdminProfiles(userIds),
  ]);

  return records.map((record) => ({
    id: record.id,
    key: record.key,
    prizeName: ECO_PRIZES[record.key].name,
    prizeEmoji: ECO_PRIZES[record.key].emoji,
    originalUserId: record.originalUserId,
    originalUsername: getAdminUsername(usernames, record.originalUserId),
    originalDisplayName: profiles.get(record.originalUserId)?.displayName ?? null,
    thiefUserId: record.thiefUserId,
    thiefUsername: getAdminUsername(usernames, record.thiefUserId),
    thiefDisplayName: profiles.get(record.thiefUserId)?.displayName ?? null,
    message: record.message,
    stolenAt: record.stolenAt,
    resolvedAt: record.resolvedAt ?? null,
    outcome: record.outcome ?? null,
  }));
}

async function buildEcoAdminManualTrash(
  users: EcoAdminUserRecord[],
  options: { page?: number; limit?: number } = {},
): Promise<EcoAdminManualTrashResult> {
  const days = getRecentChinaDateKeys(7);
  const hashes = await Promise.all(
    days.map((dateKey) => kv.hgetall<Record<string, unknown>>(ECO_MANUAL_TRASH_KEY(dateKey))),
  );
  const usernameById = buildAllUsernames(users);
  const userIds = new Set<number>(
    users
      .map((user) => Number(user.id))
      .filter((userId) => Number.isSafeInteger(userId) && userId > 0),
  );

  for (const hash of hashes) {
    for (const field of Object.keys(hash ?? {})) {
      const userId = Number(field);
      if (Number.isSafeInteger(userId) && userId > 0) {
        userIds.add(userId);
      }
    }
  }

  const allRows = Array.from(userIds).map((userId) => {
    const dayCounts = days.reduce((acc, dateKey, index) => {
      acc[dateKey] = safeStatNumber(hashes[index]?.[String(userId)]);
      return acc;
    }, {} as Record<string, number>);
    return {
      userId,
      total: days.reduce((sum, dateKey) => sum + dayCounts[dateKey], 0),
      days: dayCounts,
    };
  }).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    const nameCompare = getAdminUsername(usernameById, a.userId).localeCompare(
      getAdminUsername(usernameById, b.userId),
      'zh-CN',
    );
    if (nameCompare !== 0) return nameCompare;
    return a.userId - b.userId;
  });

  const limit = 10;
  const total = allRows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const requestedPage = Math.floor(options.page ?? 1);
  const page = Math.min(totalPages, Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1));
  const start = (page - 1) * limit;
  const pageRows = allRows.slice(start, start + limit);
  const profiles = await loadAdminProfiles(pageRows.map((row) => row.userId));

  return {
    days,
    rows: pageRows.map((row) => {
      const profile = profiles.get(row.userId);
      return {
        userId: row.userId,
        username: getAdminUsername(usernameById, row.userId),
        displayName: profile?.displayName ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
        total: row.total,
        days: row.days,
      };
    }),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

export async function getEcoAdminOverview(
  options: { trashPage?: number; trashLimit?: number } = {},
): Promise<EcoAdminOverview> {
  const users = await getAllUsers();
  const [prizes, thefts, manualTrash] = await Promise.all([
    buildEcoAdminPrizeSummaries(users),
    buildEcoAdminTheftViews(),
    buildEcoAdminManualTrash(users, { page: options.trashPage, limit: options.trashLimit }),
  ]);

  return {
    generatedAt: Date.now(),
    prizes,
    thefts,
    manualTrash,
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
  await runEcoTheftInvestigations({ limit: 8 }).catch((error) => {
    console.error('推进环保行动偷盗追查失败:', error);
  });
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
    const manualTrash = Math.min(collectable, boundedDrags * BASE_GRAB_SIZE);
    state.pending = Math.max(0, state.pending - collectable);
    if (boostedDrags > 0) {
      state.gloveUsesRemaining = Math.max(0, state.gloveUsesRemaining - boostedDrags);
    }
    const credited = await creditTrash(state, collectable, '手动回收');
    const status = await buildEcoStatus(state, offline);
    return { cleared: credited.cleared, points: credited.points, status, manualTrash };
  });

  if (!result.ok) return { ok: false, message: result.message };
  await recordEcoManualTrash(userId, result.value.manualTrash);
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

export async function claimEcoPrize(
  userId: number,
  prizeId: string,
  options: { makePublic?: boolean } = {},
): Promise<EcoClaimPrizeResult> {
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
    const now = Date.now();
    const availableAt = getNextChinaSixAt(now);
    const lot: EcoPrizeLot = {
      id: nanoid(),
      key: prize.key,
      acquiredAt: now,
      availableAt,
      limited: prize.limited === true,
      source: 'claim',
      publicEntryId: null,
      merchantAvailableAt: null,
    };
    state.inventory[prize.key] = (state.inventory[prize.key] ?? 0) + 1;
    if (prize.limited === true) {
      state.limitedPrizeInventory[prize.key] = (state.limitedPrizeInventory[prize.key] ?? 0) + 1;
    }
    state.prizeLots.push(lot);
    if (options.makePublic === true) {
      await withEcoGlobalPrizeLock(async () => {
        const entries = await loadPublicPrizeEntries();
        const previousEntries = clonePublicPrizeEntries(entries);
        const entryId = nanoid();
        const ownerName = await getEcoUserName(userId);
        const ownerProfile = await getCustomUserProfile(userId).catch(() => null);
        lot.publicEntryId = entryId;
        lot.publiclyListedAt = now;
        lot.merchantAvailableAt = availableAt;
        entries.push({
          id: entryId,
          key: prize.key,
          ownerUserId: userId,
          ownerName,
          ownerAvatarUrl: ownerProfile?.avatarUrl ?? null,
          ownerLotId: lot.id,
          publicAt: now,
          merchantAvailableAt: availableAt,
          status: 'listed',
        });
        await savePublicPrizeEntries(entries);
        registerPublicPrizeEntriesRollback(state, previousEntries);
      });
    }
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
    const now = Date.now();
    const eligibleLots = state.prizeLots
      .filter((lot) => (
        lot.key === key
        && lot.source !== 'stolen'
        && lot.availableAt <= now
      ))
      .sort((a, b) => a.acquiredAt - b.acquiredAt);
    const legacySellable = getLegacyPrizeInventory(state, key);
    if (legacySellable + eligibleLots.length < safeQuantity) {
      return { ok: false as const, message: '该奖品需要等到次日早上 6 点后才能出售' };
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
    const removedLots = eligibleLots.slice(0, Math.min(eligibleLots.length, safeQuantity));
    const removedPublicEntryIds = removedLots
      .map((lot) => lot.publicEntryId)
      .filter((entryId): entryId is string => typeof entryId === 'string' && entryId.length > 0);
    const lotsToRemove = removedLots.length;
    if (lotsToRemove > 0) {
      const removeIds = new Set(removedLots.map((lot) => lot.id));
      state.prizeLots = state.prizeLots.filter((lot) => !removeIds.has(lot.id));
    }
    state.inventory[key] = Math.max(0, owned - safeQuantity);
    const limitedOwned = state.limitedPrizeInventory[key] ?? 0;
    const limitedSold = Math.min(
      removedLots.filter((lot) => lot.limited === true).length,
      limitedOwned,
    );
    if (limitedSold > 0) {
      state.limitedPrizeInventory[key] = Math.max(0, limitedOwned - limitedSold);
    }
    if (limitedSold > 0 || removedPublicEntryIds.length > 0) {
      await withEcoGlobalPrizeLock(async () => {
        if (limitedSold > 0) {
          await adjustGlobalPrizeStockWithRollback(state, key, -limitedSold);
        }
        if (removedPublicEntryIds.length > 0) {
          const entryIds = new Set(removedPublicEntryIds);
          const entries = await loadPublicPrizeEntries();
          await savePublicPrizeEntries(entries.filter((entry) => !entryIds.has(entry.id)));
          registerPublicPrizeEntriesRollback(state, entries);
        }
      });
    }
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

export async function sellEcoPrizeToMerchant(
  userId: number,
  key: EcoPrizeKey,
): Promise<EcoSellPrizeResult> {
  if (!ECO_PRIZE_KEYS.includes(key)) {
    return { ok: false, message: '未知奖品' };
  }

  const result = await withEcoLock(userId, async (state) => {
    await advanceEco(state, { allowOnlinePrizes: true });
    const now = Date.now();
    const lot = state.prizeLots
      .filter((item) => (
        item.key === key
        && item.publicEntryId
        && item.source !== 'stolen'
        && (item.merchantAvailableAt ?? Number.POSITIVE_INFINITY) <= now
      ))
      .sort((a, b) => (a.merchantAvailableAt ?? 0) - (b.merchantAvailableAt ?? 0))[0];
    if (!lot) {
      return { ok: false as const, message: '商人还没有到，公开后的奖品需等到次日早上 6 点' };
    }

    const dateKey = getTodayDateString();
    const marketPrice = getEcoPrizePrice(key, dateKey, await loadPrizeClaimStats(getPreviousDateString(dateKey)));
    const total = Math.floor(marketPrice * 1.2);
    const awarded = await addPoints(userId, total, 'game_play', `环保行动商人收购·${ECO_PRIZES[key].name}`);
    registerEcoCompensation(state, async () => {
      await deductPoints(userId, total, 'game_play', `环保行动商人收购·${ECO_PRIZES[key].name}回滚`);
    });

    state.prizeLots = state.prizeLots.filter((item) => item.id !== lot.id);
    state.inventory[key] = Math.max(0, (state.inventory[key] ?? 0) - 1);
    if (lot.limited === true) {
      state.limitedPrizeInventory[key] = Math.max(0, (state.limitedPrizeInventory[key] ?? 0) - 1);
      await withEcoGlobalPrizeLock(async () => {
        await adjustGlobalPrizeStockWithRollback(state, key, -1);
        const entries = await loadPublicPrizeEntries();
        await savePublicPrizeEntries(entries.filter((entry) => entry.id !== lot.publicEntryId));
        registerPublicPrizeEntriesRollback(state, entries);
      });
    } else if (lot.publicEntryId) {
      await withEcoGlobalPrizeLock(async () => {
        const entries = await loadPublicPrizeEntries();
        await savePublicPrizeEntries(entries.filter((entry) => entry.id !== lot.publicEntryId));
        registerPublicPrizeEntriesRollback(state, entries);
      });
    }

    state.points = awarded.balance;
    state.lifetimePoints += total;
    const status = await buildEcoStatus(state, null);
    return { ok: true as const, status, quantitySold: 1, price: total, pointsEarned: total };
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

export async function sellStolenEcoPrizeOnBlackMarket(
  userId: number,
  key: EcoPrizeKey,
): Promise<EcoSellPrizeResult> {
  if (!ECO_PRIZE_KEYS.includes(key)) {
    return { ok: false, message: '未知奖品' };
  }

  const result = await withEcoLock(userId, async (state) => {
    await advanceEco(state, { allowOnlinePrizes: true });
    const now = Date.now();
    const lot = state.prizeLots
      .filter((item) => item.key === key && item.source === 'stolen' && (item.blackMarketAvailableAt ?? Infinity) <= now)
      .sort((a, b) => (a.blackMarketAvailableAt ?? 0) - (b.blackMarketAvailableAt ?? 0))[0];
    if (!lot) {
      return { ok: false as const, message: '黑市还没有接货，偷来的奖品需要躲过 24 小时追查' };
    }

    const total = ECO_PRIZES[key].maxPrice;
    const awarded = await addPoints(userId, total, 'game_play', `环保行动黑市出售·${ECO_PRIZES[key].name}`);
    registerEcoCompensation(state, async () => {
      await deductPoints(userId, total, 'game_play', `环保行动黑市出售·${ECO_PRIZES[key].name}回滚`);
    });

    state.prizeLots = state.prizeLots.filter((item) => item.id !== lot.id);
    state.inventory[key] = Math.max(0, (state.inventory[key] ?? 0) - 1);
    if (lot.limited === true) {
      state.limitedPrizeInventory[key] = Math.max(0, (state.limitedPrizeInventory[key] ?? 0) - 1);
      await withEcoGlobalPrizeLock(async () => {
        await adjustGlobalPrizeStockWithRollback(state, key, -1);
        const thefts = await loadTheftRecords();
        const previousThefts = cloneTheftRecords(thefts);
        const theft = thefts.find((record) => record.id === lot.theftId);
        if (theft) {
          theft.resolvedAt = now;
          theft.outcome = 'escaped';
          const entries = await loadPublicPrizeEntries();
          const previousEntries = clonePublicPrizeEntries(entries);
          await Promise.all([
            saveTheftRecords(thefts),
            savePublicPrizeEntries(entries.filter((entry) => entry.id !== theft.publicEntryId)),
          ]);
          registerTheftRecordsRollback(state, previousThefts);
          registerPublicPrizeEntriesRollback(state, previousEntries);
        }
      });
    } else if (lot.theftId) {
      await withEcoGlobalPrizeLock(async () => {
        const thefts = await loadTheftRecords();
        const previousThefts = cloneTheftRecords(thefts);
        const theft = thefts.find((record) => record.id === lot.theftId);
        if (!theft) return;
        theft.resolvedAt = now;
        theft.outcome = 'escaped';
        const entries = await loadPublicPrizeEntries();
        const previousEntries = clonePublicPrizeEntries(entries);
        await Promise.all([
          saveTheftRecords(thefts),
          savePublicPrizeEntries(entries.filter((entry) => entry.id !== theft.publicEntryId)),
        ]);
        registerTheftRecordsRollback(state, previousThefts);
        registerPublicPrizeEntriesRollback(state, previousEntries);
      });
    }
    state.points = awarded.balance;
    state.lifetimePoints += total;
    const status = await buildEcoStatus(state, null);
    return { ok: true as const, status, quantitySold: 1, price: total, pointsEarned: total };
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

export async function stealEcoPublicPrize(
  thiefUserId: number,
  publicEntryId: string,
  message: string,
): Promise<EcoActionResult> {
  const cleanMessage = message.trim().slice(0, 40);
  if (!publicEntryId || !cleanMessage) {
    return { ok: false, message: '请输入偷盗留言' };
  }
  const now = Date.now();

  const targetEntry = await withEcoGlobalPrizeLock(async () => {
    const entries = await loadPublicPrizeEntries();
    return entries.find((entry) => entry.id === publicEntryId && entry.status === 'listed') ?? null;
  });
  if (!targetEntry) return { ok: false, message: '这个奖品已经不能偷了' };
  if (targetEntry.ownerUserId === thiefUserId) return { ok: false, message: '不能偷自己的奖品' };
  if (isPublicEntryStealProtected(targetEntry, now)) return { ok: false, message: '这个奖品还在保护期内' };

  const hasActiveTheft = await withEcoGlobalPrizeLock(async () => {
    const thefts = await loadTheftRecords();
    return hasActiveEcoTheft(thefts, thiefUserId);
  });
  if (hasActiveTheft) {
    return { ok: false, message: '你还有正在被警察追查的奖品，逃脱或被抓后才能继续偷盗' };
  }

  const result = await withTwoEcoLocks(targetEntry.ownerUserId, thiefUserId, async (ownerState, thiefState) => {
    await Promise.all([
      advanceEco(ownerState, { allowOnlinePrizes: false }),
      advanceEco(thiefState, { allowOnlinePrizes: false }),
    ]);

    const lot = ownerState.prizeLots.find((item) => item.id === targetEntry.ownerLotId && item.publicEntryId === publicEntryId);
    if (!lot) {
      return { ok: false as const, message: '这个奖品已经不存在了' };
    }

    const thiefLotId = nanoid();
    const theftId = nanoid();
    const thiefName = await getEcoUserName(thiefUserId);

    const reservation = await withEcoGlobalPrizeLock(async () => {
      const entries = await loadPublicPrizeEntries();
      const previousEntries = clonePublicPrizeEntries(entries);
      const currentEntry = entries.find((entry) => entry.id === publicEntryId);
      if (
        !currentEntry
        || currentEntry.status !== 'listed'
        || currentEntry.ownerUserId !== ownerState.userId
        || currentEntry.ownerLotId !== lot.id
      ) {
        return { ok: false as const, message: '这个奖品已经不能偷了' };
      }
      if (isPublicEntryStealProtected(currentEntry, now)) {
        return { ok: false as const, message: '这个奖品还在保护期内' };
      }

      const thefts = await loadTheftRecords();
      const previousThefts = cloneTheftRecords(thefts);
      if (hasActiveEcoTheft(thefts, thiefUserId)) {
        return { ok: false as const, message: '你还有正在被警察追查的奖品，逃脱或被抓后才能继续偷盗' };
      }

      const nextEntries = entries.map((entry) => (
        entry.id === publicEntryId
          ? {
              ...entry,
              status: 'stolen' as const,
              thiefUserId,
              thiefName,
              theftMessage: cleanMessage,
              stolenAt: now,
              stealProtectedUntil: null,
            }
          : entry
      ));
      const caughtCountBeforeTheft = getPublicEntryTheftCaughtCount(currentEntry);
      thefts.push({
        id: theftId,
        key: lot.key,
        originalUserId: ownerState.userId,
        thiefUserId,
        publicEntryId,
        originalLotId: lot.id,
        thiefLotId,
        stolenAt: now,
        nextCheckAt: now + ECO_THEFT_CHECK_INTERVAL_MS,
        blackMarketAvailableAt: now + THEFT_BLACK_MARKET_DELAY_MS,
        caughtCountBeforeTheft,
        message: cleanMessage,
      });
      await Promise.all([
        savePublicPrizeEntries(nextEntries),
        saveTheftRecords(thefts),
      ]);
      registerPublicPrizeEntriesRollback(ownerState, previousEntries);
      registerTheftRecordsRollback(ownerState, previousThefts);
      return { ok: true as const };
    });
    if (!reservation.ok) {
      return { ok: false as const, message: reservation.message };
    }

    ownerState.prizeLots = ownerState.prizeLots.filter((item) => item.id !== lot.id);
    ownerState.inventory[lot.key] = Math.max(0, (ownerState.inventory[lot.key] ?? 0) - 1);
    if (lot.limited === true) {
      ownerState.limitedPrizeInventory[lot.key] = Math.max(0, (ownerState.limitedPrizeInventory[lot.key] ?? 0) - 1);
      thiefState.limitedPrizeInventory[lot.key] = (thiefState.limitedPrizeInventory[lot.key] ?? 0) + 1;
    }
    thiefState.inventory[lot.key] = (thiefState.inventory[lot.key] ?? 0) + 1;
    thiefState.prizeLots.push({
      id: thiefLotId,
      key: lot.key,
      acquiredAt: now,
      availableAt: now + THEFT_BLACK_MARKET_DELAY_MS,
      limited: lot.limited === true,
      source: 'stolen',
      stolenFromUserId: ownerState.userId,
      stolenAt: now,
      theftId,
      blackMarketAvailableAt: now + THEFT_BLACK_MARKET_DELAY_MS,
    });

    const status = await buildEcoStatus(thiefState, null);
    return { ok: true as const, status };
  });

  if (!result.ok) return { ok: false, message: result.message };
  if (!result.value.ok) return { ok: false, message: result.value.message };
  return { ok: true, data: result.value.status };
}

async function updateActiveTheftRecord(
  recordId: string,
  update: (record: EcoTheftRecord) => EcoTheftRecord,
): Promise<boolean> {
  return withEcoGlobalPrizeLock(async () => {
    const thefts = await loadTheftRecords();
    const index = thefts.findIndex((record) => record.id === recordId);
    if (index < 0 || thefts[index].resolvedAt) return false;
    thefts[index] = update({ ...thefts[index] });
    await saveTheftRecords(thefts);
    return true;
  });
}

async function markTheftEscaped(record: EcoTheftRecord, now: number): Promise<boolean> {
  return withEcoGlobalPrizeLock(async () => {
    const thefts = await loadTheftRecords();
    const index = thefts.findIndex((item) => item.id === record.id);
    if (index < 0 || thefts[index].resolvedAt) return false;
    const previousThefts = cloneTheftRecords(thefts);
    const entries = await loadPublicPrizeEntries();
    const previousEntries = clonePublicPrizeEntries(entries);

    thefts[index] = {
      ...thefts[index],
      resolvedAt: now,
      outcome: 'escaped',
    };
    try {
      await Promise.all([
        saveTheftRecords(thefts),
        savePublicPrizeEntries(entries.filter((entry) => entry.id !== record.publicEntryId)),
      ]);
    } catch (error) {
      await Promise.allSettled([
        saveTheftRecords(previousThefts),
        savePublicPrizeEntries(previousEntries),
      ]);
      throw error;
    }
    return true;
  });
}

async function processEcoTheftInvestigations(
  limit: number,
): Promise<Omit<EcoTheftInvestigationRunResult, 'locked'>> {
  const now = Date.now();
  const thefts = await loadTheftRecords();
  const due = thefts.filter((record) => (
    !record.resolvedAt
    && record.nextCheckAt <= now
  )).slice(0, limit);
  if (due.length === 0) {
    return { checked: 0, caught: 0, escaped: 0, rescheduled: 0, skipped: 0 };
  }

  const stats = { checked: 0, caught: 0, escaped: 0, rescheduled: 0, skipped: 0 };
  for (const record of due) {
    stats.checked += 1;
    if (now >= record.blackMarketAvailableAt) {
      const escaped = await markTheftEscaped(record, now);
      if (escaped) stats.escaped += 1;
      else stats.skipped += 1;
      continue;
    }

    const caughtProbability = calculateEcoTheftCaughtProbability(
      record.stolenAt,
      now,
      record.caughtCountBeforeTheft ?? 0,
    );
    if (Math.random() >= caughtProbability) {
      const rescheduled = await updateActiveTheftRecord(record.id, (current) => ({
        ...current,
        nextCheckAt: Math.min(
          current.blackMarketAvailableAt,
          current.nextCheckAt + ECO_THEFT_CHECK_INTERVAL_MS,
        ),
      }));
      if (rescheduled) stats.rescheduled += 1;
      else stats.skipped += 1;
      continue;
    }

    const result = await withTwoEcoLocks(record.originalUserId, record.thiefUserId, async (ownerState, thiefState) => {
      const stolenLot = thiefState.prizeLots.find((lot) => lot.id === record.thiefLotId && lot.source === 'stolen');
      if (!stolenLot) return false;
      const restoredLotId = nanoid();
      const merchantAvailableAt = Math.max(now, getNextChinaSixAt(record.stolenAt));
      thiefState.prizeLots = thiefState.prizeLots.filter((lot) => lot.id !== stolenLot.id);
      thiefState.inventory[record.key] = Math.max(0, (thiefState.inventory[record.key] ?? 0) - 1);
      if (stolenLot.limited === true) {
        thiefState.limitedPrizeInventory[record.key] = Math.max(0, (thiefState.limitedPrizeInventory[record.key] ?? 0) - 1);
        ownerState.limitedPrizeInventory[record.key] = (ownerState.limitedPrizeInventory[record.key] ?? 0) + 1;
      }
      ownerState.inventory[record.key] = (ownerState.inventory[record.key] ?? 0) + 1;
      ownerState.prizeLots.push({
        id: restoredLotId,
        key: record.key,
        acquiredAt: now,
        availableAt: merchantAvailableAt,
        limited: stolenLot.limited === true,
        source: 'restored',
        publicEntryId: record.publicEntryId,
        publiclyListedAt: record.stolenAt,
        merchantAvailableAt,
      });

      const dateKey = getTodayDateString();
      const marketPrice = getEcoPrizePrice(record.key, dateKey, await loadPrizeClaimStats(getPreviousDateString(dateKey)));
      const penaltyTarget = Math.floor(marketPrice * 0.1);
      const thiefBalance = await getUserPoints(record.thiefUserId);
      const penalty = Math.max(0, Math.min(thiefBalance, penaltyTarget));
      if (penalty > 0) {
        await applyPointsDelta(record.thiefUserId, -penalty, 'game_play', `环保行动偷盗处罚·${ECO_PRIZES[record.key].name}`);
        registerEcoCompensation(thiefState, async () => {
          await addPoints(record.thiefUserId, penalty, 'game_play', `环保行动偷盗处罚回滚·${ECO_PRIZES[record.key].name}`);
        });
        const compensation = Math.floor(penalty * 0.5);
        if (compensation > 0) {
          await addPoints(record.originalUserId, compensation, 'game_play', `环保行动偷盗赔偿·${ECO_PRIZES[record.key].name}`);
          registerEcoCompensation(ownerState, async () => {
            await deductPoints(record.originalUserId, compensation, 'game_play', `环保行动偷盗赔偿回滚·${ECO_PRIZES[record.key].name}`);
          });
        }
      }
      const forceUntil = now + THIEF_FORCED_ACHIEVEMENT_MS;
      await grantUserAchievement(record.thiefUserId, 'thief', {
        source: 'auto',
        grantedAt: now,
        expiresAt: forceUntil,
        reason: '环保行动偷盗被警察抓住',
      });
      await forceEquipAchievement(record.thiefUserId, 'thief', forceUntil);

      const recordResolved = await withEcoGlobalPrizeLock(async () => {
        const entries = await loadPublicPrizeEntries();
        const previousEntries = clonePublicPrizeEntries(entries);
        const thefts = await loadTheftRecords();
        const theftIndex = thefts.findIndex((item) => item.id === record.id);
        if (theftIndex < 0 || thefts[theftIndex].resolvedAt) {
          return false;
        }
        const previousThefts = cloneTheftRecords(thefts);
        thefts[theftIndex] = {
          ...thefts[theftIndex],
          resolvedAt: now,
          outcome: 'caught',
        };
        const nextEntries = entries.map((entry) => {
          if (entry.id !== record.publicEntryId) return entry;
          const nextCaughtCount = Math.max(
            getPublicEntryTheftCaughtCount(entry),
            Math.max(0, Math.floor(record.caughtCountBeforeTheft ?? 0)),
          ) + 1;
          return {
            ...entry,
            ownerLotId: restoredLotId,
            status: 'listed' as const,
            merchantAvailableAt,
            stealProtectedUntil: now + ECO_THEFT_PROTECTION_MS,
            theftCaughtCount: nextCaughtCount,
            thiefUserId: null,
            thiefName: null,
            theftMessage: null,
            stolenAt: null,
          };
        });
        await Promise.all([
          savePublicPrizeEntries(nextEntries),
          saveTheftRecords(thefts),
        ]);
        registerPublicPrizeEntriesRollback(ownerState, previousEntries);
        registerTheftRecordsRollback(ownerState, previousThefts);
        return true;
      });
      return recordResolved;
    });

    if (result.ok && result.value) {
      stats.caught += 1;
    } else {
      const rescheduled = await updateActiveTheftRecord(record.id, (current) => ({
        ...current,
        nextCheckAt: Math.min(
          current.blackMarketAvailableAt,
          current.nextCheckAt + ECO_THEFT_CHECK_INTERVAL_MS,
        ),
      }));
      if (rescheduled) stats.rescheduled += 1;
      else stats.skipped += 1;
    }
  }

  return stats;
}

export async function runEcoTheftInvestigations(
  options: { limit?: number } = {},
): Promise<EcoTheftInvestigationRunResult> {
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 25), 100));
  const lock = await acquireEcoTheftInvestigationLock();
  if (!lock) {
    return { checked: 0, caught: 0, escaped: 0, rescheduled: 0, skipped: 0, locked: false };
  }

  try {
    const stats = await processEcoTheftInvestigations(limit);
    return { ...stats, locked: true };
  } finally {
    await releaseEcoTheftInvestigationLock(lock);
  }
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
