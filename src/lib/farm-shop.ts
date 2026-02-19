// src/lib/farm-shop.ts - 农场道具商店后端逻辑

import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import seedrandom from 'seedrandom';
import type { FarmShopItem, ActiveBuff } from './types/farm-shop';
import type { FarmState, CropId, WeatherType } from './types/farm';
import { DEFAULT_FARM_SHOP_ITEMS } from './farm-shop-config';
import { CROPS } from './farm-config';
import { addGamePointsWithLimit, addPoints, deductPoints } from './points';
import { getTodayDateString } from './time';
import {
  buildBuffContext, computePlotState, computeHarvestYield,
  refreshFarmState, getTodayWeather, createEmptyPlot, checkLevelUp,
} from './farm-engine';
import { getDailyPointsLimit } from './config';
import { getOrCreateFarm } from './farm';

// ---- KV 键 ----

const FARM_SHOP_ITEMS_KEY = 'farm:shop:items';
const FARM_SHOP_DAILY_KEY = (userId: number, date: string, itemId: string) =>
  `farm:shop:daily:${userId}:${date}:${itemId}`;
const FARM_SHOP_LOG_KEY = (userId: number) => `farm:shop:log:${userId}`;
const FARM_SHOP_PURCHASE_COUNTS_KEY = 'farm:shop:purchase_counts';
const FARM_STATE_KEY = (userId: number) => `farm:state:${userId}`;
const FARM_SHOP_INIT_LOCK_KEY = 'farm:shop:init:lock';
const FARM_ACTION_LOCK_KEY = (userId: number) => `farm:lock:action:${userId}`;

const FARM_ACTION_LOCK_TTL_SECONDS = 15;
const FARM_ACTION_LOCK_RETRY_MS = 80;
const FARM_ACTION_LOCK_MAX_RETRIES = 15;
const FARM_SHOP_INIT_LOCK_TTL_SECONDS = 10;

interface FarmActionLock {
  key: string;
  token: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function acquireFarmActionLock(userId: number): Promise<FarmActionLock | null> {
  const key = FARM_ACTION_LOCK_KEY(userId);
  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  for (let attempt = 0; attempt < FARM_ACTION_LOCK_MAX_RETRIES; attempt += 1) {
    const locked = await kv.set(key, token, { nx: true, ex: FARM_ACTION_LOCK_TTL_SECONDS });
    if (locked === 'OK') return { key, token };
    await sleep(FARM_ACTION_LOCK_RETRY_MS);
  }

  return null;
}

async function releaseFarmActionLock(lock: FarmActionLock): Promise<void> {
  const releaseScript = `
    local key = KEYS[1]
    local expected = ARGV[1]
    local current = redis.call('GET', key)
    if current == expected then
      return redis.call('DEL', key)
    end
    return 0
  `;

  try {
    await kv.eval(releaseScript, [lock.key], [lock.token]);
  } catch (error) {
    console.error('Release farm-shop action lock failed:', error);
  }
}

function cloneFarmState(state: FarmState): FarmState {
  return JSON.parse(JSON.stringify(state)) as FarmState;
}

function parseNumericCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function rollbackDailyLimit(dailyLimitKey: string | null): Promise<void> {
  if (!dailyLimitKey) return;
  try {
    await kv.decr(dailyLimitKey);
  } catch (error) {
    console.error('Rollback farm shop daily-limit failed:', error);
  }
}

// ---- 管理 CRUD ----

/**
 * 初始化默认道具（首次访问时）
 */
export async function initDefaultFarmShopItems(): Promise<void> {
  const existing = await kv.hgetall<Record<string, FarmShopItem>>(FARM_SHOP_ITEMS_KEY);
  if (existing && Object.keys(existing).length > 0) return;

  const initToken = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const lockResult = await kv.set(FARM_SHOP_INIT_LOCK_KEY, initToken, {
    nx: true,
    ex: FARM_SHOP_INIT_LOCK_TTL_SECONDS,
  });

  if (lockResult !== 'OK') {
    // 其他请求正在初始化，等待初始化完成
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await sleep(80);
      const synced = await kv.hgetall<Record<string, FarmShopItem>>(FARM_SHOP_ITEMS_KEY);
      if (synced && Object.keys(synced).length > 0) return;
    }
    return;
  }

  const releaseScript = `
    local key = KEYS[1]
    local expected = ARGV[1]
    local current = redis.call('GET', key)
    if current == expected then
      return redis.call('DEL', key)
    end
    return 0
  `;

  try {
    const recheck = await kv.hgetall<Record<string, FarmShopItem>>(FARM_SHOP_ITEMS_KEY);
    if (recheck && Object.keys(recheck).length > 0) return;

    const now = Date.now();
    for (const item of DEFAULT_FARM_SHOP_ITEMS) {
      const id = nanoid();
      const shopItem: FarmShopItem = {
        ...item,
        id,
        createdAt: now,
        updatedAt: now,
      };
      await kv.hset(FARM_SHOP_ITEMS_KEY, { [id]: shopItem });
    }
  } finally {
    try {
      await kv.eval(releaseScript, [FARM_SHOP_INIT_LOCK_KEY], [initToken]);
    } catch (error) {
      console.error('Release farm shop init lock failed:', error);
    }
  }
}

/**
 * 获取所有道具（含下架，管理员用）
 */
export async function getAllFarmShopItems(): Promise<FarmShopItem[]> {
  await initDefaultFarmShopItems();
  const items = await kv.hgetall<Record<string, FarmShopItem>>(FARM_SHOP_ITEMS_KEY);
  if (!items) return [];
  return Object.values(items).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * 获取上架道具
 */
export async function getActiveFarmShopItems(): Promise<FarmShopItem[]> {
  await initDefaultFarmShopItems();
  const items = await kv.hgetall<Record<string, FarmShopItem>>(FARM_SHOP_ITEMS_KEY);
  if (!items) return [];
  return Object.values(items)
    .filter(item => item.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * 获取单个道具
 */
export async function getFarmShopItem(itemId: string): Promise<FarmShopItem | null> {
  const item = await kv.hget<FarmShopItem>(FARM_SHOP_ITEMS_KEY, itemId);
  return item;
}

/**
 * 创建道具
 */
export async function createFarmShopItem(
  data: Omit<FarmShopItem, 'id' | 'createdAt' | 'updatedAt'>
): Promise<FarmShopItem> {
  const now = Date.now();
  const id = nanoid();
  const item: FarmShopItem = {
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  };
  await kv.hset(FARM_SHOP_ITEMS_KEY, { [id]: item });
  return item;
}

/**
 * 更新道具
 */
export async function updateFarmShopItem(
  id: string,
  updates: Partial<Omit<FarmShopItem, 'id' | 'createdAt'>>
): Promise<FarmShopItem | null> {
  const existing = await getFarmShopItem(id);
  if (!existing) return null;

  const updated: FarmShopItem = {
    ...existing,
    ...updates,
    id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  await kv.hset(FARM_SHOP_ITEMS_KEY, { [id]: updated });
  return updated;
}

/**
 * 删除道具
 */
export type DeleteFarmShopItemResult =
  | { success: false; reason: 'not_found' }
  | { success: true; archived: boolean };

export async function deleteFarmShopItem(id: string): Promise<DeleteFarmShopItemResult> {
  const existing = await getFarmShopItem(id);
  if (!existing) return { success: false, reason: 'not_found' };

  // 历史上被购买过的道具不做硬删除，避免背包孤儿库存无法显示/使用。
  const purchaseCountRaw = await kv.hget(FARM_SHOP_PURCHASE_COUNTS_KEY, id);
  const purchaseCount = parseNumericCount(purchaseCountRaw);

  if (purchaseCount > 0) {
    const archived: FarmShopItem = {
      ...existing,
      enabled: false,
      updatedAt: Date.now(),
    };
    await kv.hset(FARM_SHOP_ITEMS_KEY, { [id]: archived });
    return { success: true, archived: true };
  }

  await kv.hdel(FARM_SHOP_ITEMS_KEY, id);
  return { success: true, archived: false };
}

// ---- 用户购买 ----

/**
 * 购买农场道具
 */
export async function purchaseFarmShopItem(
  userId: number,
  itemId: string,
  farmStateFromCaller?: FarmState,
): Promise<{
  success: boolean;
  message?: string;
  farmState?: FarmState;
  newBalance?: number;
}> {
  const lock = await acquireFarmActionLock(userId);
  if (!lock) {
    return { success: false, message: '操作处理中，请稍后重试' };
  }

  try {
    const farmState = await getOrCreateFarm(userId).catch(() => farmStateFromCaller);
    if (!farmState) {
      return { success: false, message: '读取农场状态失败，请稍后重试' };
    }

    // 1. 验证商品
    const item = await getFarmShopItem(itemId);
    if (!item || !item.enabled) {
      return { success: false, message: '商品不存在或已下架' };
    }

    // 等级限制
    if (item.unlockLevel && farmState.level < item.unlockLevel) {
      return { success: false, message: `需要农场等级 ${item.unlockLevel} 才能购买` };
    }

    // 2. 检查每日限购
    const today = getTodayDateString();
    let dailyLimitKey: string | null = null;
    if (item.dailyLimit && item.dailyLimit > 0) {
      dailyLimitKey = FARM_SHOP_DAILY_KEY(userId, today, itemId);
      const limitLuaScript = `
        local key = KEYS[1]
        local limit = tonumber(ARGV[1])
        local ttl = tonumber(ARGV[2])
        local newCount = redis.call('INCR', key)
        if newCount == 1 then
          redis.call('EXPIRE', key, ttl)
        end
        if newCount > limit then
          redis.call('DECR', key)
          return {0, newCount - 1}
        end
        return {1, newCount}
      `;
      const limitResult = await kv.eval(
        limitLuaScript,
        [dailyLimitKey],
        [item.dailyLimit, 48 * 60 * 60]
      ) as [number, number];
      if (limitResult[0] !== 1) {
        return { success: false, message: `今日已达限购上限（${item.dailyLimit}次）` };
      }
    }

    // 3. 检查 buff 叠加
    const now = Date.now();
    if (item.mode === 'buff') {
      const durationMs = item.durationMs ?? 0;
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        await rollbackDailyLimit(dailyLimitKey);
        return { success: false, message: '该道具配置异常，暂时不可购买' };
      }

      const activeBuffs = (farmState.activeBuffs ?? []).filter(b => b.expiresAt > now);
      const activeSameCount = activeBuffs.filter(b => b.effect === item.effect).length;
      const maxStack = Math.max(1, Math.floor(item.maxStack ?? 1));
      if (activeSameCount >= maxStack) {
        await rollbackDailyLimit(dailyLimitKey);
        return {
          success: false,
          message: maxStack <= 1
            ? '同类 buff 已激活，请等待结束后再购买'
            : `同类 buff 最多叠加 ${maxStack} 层`,
        };
      }
    }

    // 4. 扣积分
    const deductResult = await deductPoints(
      userId, item.pointsCost, 'exchange', `农场道具: ${item.name}`
    );
    if (!deductResult.success) {
      await rollbackDailyLimit(dailyLimitKey);
      return { success: false, message: deductResult.message ?? '积分不足' };
    }

    // 5. 生效
    if (item.mode === 'buff') {
      const newBuff: ActiveBuff = {
        itemId: item.id,
        effect: item.effect,
        activatedAt: now,
        expiresAt: now + (item.durationMs ?? 0),
        effectValue: item.effectValue,
      };
      farmState.activeBuffs = [...(farmState.activeBuffs ?? []), newBuff];
    } else {
      const inventory = { ...(farmState.inventory ?? {}) };
      inventory[itemId] = (inventory[itemId] ?? 0) + 1;
      farmState.inventory = inventory;
    }

    farmState.lastUpdatedAt = now;
    try {
      await kv.set(FARM_STATE_KEY(userId), farmState);
    } catch (saveError) {
      console.error('Farm shop purchase save failed, starting rollback:', saveError);
      await rollbackDailyLimit(dailyLimitKey);
      try {
        await addPoints(userId, item.pointsCost, 'exchange', `农场道具购买失败退款: ${item.name}`);
      } catch (refundError) {
        console.error('Farm shop purchase refund failed:', refundError);
      }
      return { success: false, message: '购买失败，请稍后重试' };
    }

    // 6. 记录日志（best-effort）
    try {
      const log = {
        id: nanoid(),
        itemId,
        itemName: item.name,
        effect: item.effect,
        mode: item.mode,
        pointsCost: item.pointsCost,
        createdAt: now,
      };
      await kv.lpush(FARM_SHOP_LOG_KEY(userId), log);
      await kv.ltrim(FARM_SHOP_LOG_KEY(userId), 0, 99);
    } catch (logError) {
      console.error('Farm shop purchase log failed:', logError);
    }

    // 7. 购买次数统计（best-effort）
    try {
      await kv.hincrby(FARM_SHOP_PURCHASE_COUNTS_KEY, itemId, 1);
    } catch (countError) {
      console.error('Farm shop purchase count increment failed:', countError);
    }

    const weather = getTodayWeather(getTodayDateString());
    return {
      success: true,
      farmState: refreshFarmState(farmState, now, weather),
      newBalance: deductResult.balance,
    };
  } finally {
    await releaseFarmActionLock(lock);
  }
}

// ---- 即时道具使用 ----

/**
 * 使用即时道具
 */
export async function useInstantItem(
  userId: number,
  itemId: string,
  farmStateFromCaller?: FarmState,
  plotIndex?: number,
): Promise<{
  success: boolean;
  message?: string;
  farmState?: FarmState;
}> {
  const lock = await acquireFarmActionLock(userId);
  if (!lock) {
    return { success: false, message: '操作处理中，请稍后重试' };
  }

  try {
    const farmState = await getOrCreateFarm(userId).catch(() => farmStateFromCaller);
    if (!farmState) {
      return { success: false, message: '读取农场状态失败，请稍后重试' };
    }

    const now = Date.now();
    const weather = getTodayWeather(getTodayDateString());
    const inventory = farmState.inventory ?? {};

    if (!inventory[itemId] || inventory[itemId] <= 0) {
      return { success: false, message: '背包中没有该道具' };
    }

    const item = await getFarmShopItem(itemId);
    if (!item) {
      const cleanedInventory = { ...inventory };
      delete cleanedInventory[itemId];
      farmState.inventory = cleanedInventory;
      farmState.lastUpdatedAt = now;
      try {
        await kv.set(FARM_STATE_KEY(userId), farmState);
      } catch (cleanupError) {
        console.error('Clean stale inventory item failed:', cleanupError);
      }
      return { success: false, message: '该道具已失效，已从背包移除' };
    }

    if (item.mode !== 'instant') {
      return { success: false, message: '该道具不能直接使用' };
    }

    const buffCtx = buildBuffContext(farmState.activeBuffs, now);
    const resolvedPlotIndex = (
      typeof plotIndex === 'number' && Number.isInteger(plotIndex)
    ) ? plotIndex : undefined;

    switch (item.effect) {
      case 'growth_boost': {
        const boostMs = item.instantValue ?? 60 * 60 * 1000;
        let boostedCount = 0;
        for (let i = 0; i < farmState.plots.length; i++) {
          const plot = farmState.plots[i];
          if (!plot.cropId || !plot.plantedAt) continue;
          const computed = computePlotState(plot, now, weather, userId, buffCtx);
          if (computed.stage === 'withered' || computed.stage === 'mature') continue;
          farmState.plots[i] = { ...plot, plantedAt: plot.plantedAt - boostMs };
          boostedCount++;
        }
        if (boostedCount === 0) {
          return { success: false, message: '没有可以加速的作物' };
        }
        break;
      }

      case 'plot_growth_boost': {
        let targetPlotIndex = resolvedPlotIndex;
        if (
          targetPlotIndex === undefined ||
          targetPlotIndex < 0 ||
          targetPlotIndex >= farmState.plots.length
        ) {
          targetPlotIndex = farmState.plots.findIndex(plot => {
            if (!plot.cropId || !plot.plantedAt) return false;
            const computed = computePlotState(plot, now, weather, userId, buffCtx);
            return computed.stage !== 'withered' && computed.stage !== 'mature';
          });
          if (targetPlotIndex < 0) {
            return { success: false, message: '没有可以加速的作物' };
          }
        }

        const plot = farmState.plots[targetPlotIndex];
        if (!plot.cropId || !plot.plantedAt) {
          return { success: false, message: '该田地没有作物' };
        }
        const computed = computePlotState(plot, now, weather, userId, buffCtx);
        if (computed.stage === 'withered') {
          return { success: false, message: '枯萎的作物无法加速' };
        }
        if (computed.stage === 'mature') {
          return { success: false, message: '成熟的作物无需加速' };
        }
        const boostMs = item.instantValue ?? 30 * 60 * 1000;
        farmState.plots[targetPlotIndex] = { ...plot, plantedAt: plot.plantedAt - boostMs };
        break;
      }

      case 'pest_clear': {
        for (let i = 0; i < farmState.plots.length; i++) {
          const plot = farmState.plots[i];
          if (!plot.cropId || !plot.plantedAt) continue;
          const computed = computePlotState(plot, now, weather, userId, buffCtx);
          if (!computed.hasPest) continue;
          farmState.plots[i] = {
            ...plot,
            hasPest: false,
            pestAppearedAt: null,
            pestClearedAt: now,
          };
        }
        const shieldDuration = item.instantValue ?? 2 * 60 * 60 * 1000;
        const pestBuff: ActiveBuff = {
          itemId: item.id,
          effect: 'pest_shield',
          activatedAt: now,
          expiresAt: now + shieldDuration,
          effectValue: 1,
        };
        farmState.activeBuffs = [...(farmState.activeBuffs ?? []), pestBuff];
        break;
      }

      case 'random_plant': {
        let targetPlotIndex = resolvedPlotIndex;
        if (
          targetPlotIndex === undefined ||
          targetPlotIndex < 0 ||
          targetPlotIndex >= farmState.plots.length
        ) {
          targetPlotIndex = farmState.plots.findIndex(p => !p.cropId);
          if (targetPlotIndex === -1) {
            return { success: false, message: '没有空闲的田地' };
          }
        }

        const targetPlot = farmState.plots[targetPlotIndex];
        if (targetPlot.cropId) {
          return { success: false, message: '该田地已有作物' };
        }

        const unlockedCrops = farmState.unlockedCrops;
        if (unlockedCrops.length === 0) {
          return { success: false, message: '未解锁可种植作物' };
        }

        const rng = seedrandom(`random-plant-${userId}-${now}`);
        const randomCrop = unlockedCrops[Math.floor(rng() * unlockedCrops.length)] as CropId;

        farmState.plots[targetPlotIndex] = {
          index: targetPlotIndex,
          cropId: randomCrop,
          plantedAt: now,
          lastWateredAt: now,
          waterCount: 1,
          hasPest: false,
          pestAppearedAt: null,
          pestClearedAt: null,
          stage: 'seed',
          yieldMultiplier: 1.0,
        };
        break;
      }

      default:
        return { success: false, message: '该道具不能直接使用' };
    }

    const newInventory = { ...inventory };
    newInventory[itemId] = (newInventory[itemId] ?? 1) - 1;
    if (newInventory[itemId] <= 0) delete newInventory[itemId];
    farmState.inventory = newInventory;
    farmState.lastUpdatedAt = now;

    try {
      await kv.set(FARM_STATE_KEY(userId), farmState);
    } catch (saveError) {
      console.error('Farm shop use-item save failed:', saveError);
      return { success: false, message: '使用失败，请稍后重试' };
    }

    return {
      success: true,
      farmState: refreshFarmState(farmState, now, weather),
    };
  } finally {
    await releaseFarmActionLock(lock);
  }
}

// ---- 自动收获 ----

/**
 * 应用自动收获（auto_harvest buff 激活时自动收获成熟作物）
 * 在 /init 和 /status 中调用
 */
export async function applyAutoHarvest(
  farmStateFromCaller: FarmState,
  userId: number,
  weather: string,
  now: number,
): Promise<{
  farmState: FarmState;
  autoHarvestedCount: number;
  autoHarvestPoints: number;
}> {
  const weatherType = weather as WeatherType;
  const lock = await acquireFarmActionLock(userId);
  if (!lock) {
    return {
      farmState: refreshFarmState(farmStateFromCaller, now, weatherType),
      autoHarvestedCount: 0,
      autoHarvestPoints: 0,
    };
  }

  try {
    const farmState = await getOrCreateFarm(userId).catch(() => farmStateFromCaller);
    if (!farmState) {
      return {
        farmState: refreshFarmState(farmStateFromCaller, now, weatherType),
        autoHarvestedCount: 0,
        autoHarvestPoints: 0,
      };
    }

    const buffCtx = buildBuffContext(farmState.activeBuffs, now);
    if (!buffCtx?.autoHarvest?.active) {
      return {
        farmState: refreshFarmState(farmState, now, weatherType),
        autoHarvestedCount: 0,
        autoHarvestPoints: 0,
      };
    }

    const farmBeforeHarvest = cloneFarmState(farmState);
    let totalYield = 0;
    let harvestedCount = 0;
    let totalExp = 0;

    for (let i = 0; i < farmState.plots.length; i++) {
      const plot = farmState.plots[i];
      if (!plot.cropId || !plot.plantedAt) continue;

      const computed = computePlotState(plot, now, weatherType, userId, buffCtx);
      if (computed.stage !== 'mature') continue;

      const crop = CROPS[plot.cropId];
      const { yield: harvestYield } = computeHarvestYield(
        { ...plot, stage: 'mature', hasPest: computed.hasPest, pestAppearedAt: computed.pestAppearedAt },
        now,
        weatherType,
        buffCtx,
      );

      totalYield += harvestYield;
      totalExp += crop.expReward;
      harvestedCount++;

      farmState.plots[i] = createEmptyPlot(i);
    }

    if (harvestedCount === 0) {
      return {
        farmState: refreshFarmState(farmState, now, weatherType),
        autoHarvestedCount: 0,
        autoHarvestPoints: 0,
      };
    }

    farmState.exp += totalExp;
    farmState.totalHarvests += harvestedCount;
    farmState.lastUpdatedAt = now;

    const levelResult = checkLevelUp(farmState);
    if (levelResult.leveledUp) {
      Object.assign(farmState, levelResult.newState);
    }

    try {
      await kv.set(FARM_STATE_KEY(userId), farmState);
    } catch (saveError) {
      console.error('Auto harvest pre-settlement save failed:', saveError);
      return {
        farmState: refreshFarmState(farmBeforeHarvest, now, weatherType),
        autoHarvestedCount: 0,
        autoHarvestPoints: 0,
      };
    }

    let pointsEarned = 0;
    try {
      const dailyLimit = await getDailyPointsLimit();
      const pointsResult = await addGamePointsWithLimit(
        userId,
        totalYield,
        dailyLimit,
        'game_play',
        `农场自动收获: ${harvestedCount}块田地`,
      );
      pointsEarned = pointsResult.pointsEarned;
      farmState.totalEarnings += pointsEarned;
      try {
        await kv.set(FARM_STATE_KEY(userId), farmState);
      } catch (statsSaveError) {
        console.error('Auto harvest totalEarnings save failed:', statsSaveError);
      }
    } catch (error) {
      console.error('Auto harvest points settlement failed, rolling back farm state:', error);
      try {
        await kv.set(FARM_STATE_KEY(userId), farmBeforeHarvest);
      } catch (rollbackError) {
        console.error('Auto harvest rollback failed:', rollbackError);
      }
      return {
        farmState: refreshFarmState(farmBeforeHarvest, now, weatherType),
        autoHarvestedCount: 0,
        autoHarvestPoints: 0,
      };
    }

    return {
      farmState: refreshFarmState(farmState, now, weatherType),
      autoHarvestedCount: harvestedCount,
      autoHarvestPoints: pointsEarned,
    };
  } finally {
    await releaseFarmActionLock(lock);
  }
}

// ---- 购买统计 ----

/**
 * 获取购买次数统计
 */
export async function getFarmShopPurchaseCounts(
  itemIds: string[]
): Promise<Record<string, number>> {
  if (itemIds.length === 0) return {};

  try {
    const counts = await kv.hmget(
      FARM_SHOP_PURCHASE_COUNTS_KEY,
      ...itemIds
    ) as unknown;
    const result: Record<string, number> = {};

    if (Array.isArray(counts)) {
      for (let i = 0; i < itemIds.length; i++) {
        result[itemIds[i]] = parseNumericCount(counts[i]);
      }
      return result;
    }

    if (counts && typeof counts === 'object') {
      const record = counts as Record<string, unknown>;
      for (const id of itemIds) {
        result[id] = parseNumericCount(record[id]);
      }
      return result;
    }

    for (const id of itemIds) {
      result[id] = 0;
    }
    return result;
  } catch {
    return {};
  }
}
