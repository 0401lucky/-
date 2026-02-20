// src/lib/farm.ts - 农场后端业务逻辑（KV操作 + Lua脚本）

import { kv } from '@/lib/d1-kv';
import type { CropId, FarmState, FarmLevel, HarvestDetail } from './types/farm';
import { CROPS, WEATHERS, ACTION_COOLDOWN_SECONDS } from './farm-config';
import {
  createInitialFarmState, refreshFarmState, computePlotState,
  computeHarvestYield, computePestYieldMultiplier, checkLevelUp, createEmptyPlot,
  computeMissedWaterCycles, computeWaterYieldMultiplier,
  getTodayWeather,
} from './farm-engine';
import { getTodayDateString } from './time';
import { addGamePointsWithLimit, addPoints, deductPoints } from './points';
import { getDailyPointsLimit } from './config';

// ---- KV 键 ----

const FARM_STATE_KEY = (userId: number) => `farm:state:${userId}`;
const FARM_COOLDOWN_KEY = (userId: number) => `farm:cooldown:action:${userId}`;
const FARM_ACTION_LOCK_KEY = (userId: number) => `farm:lock:action:${userId}`;

const FARM_ACTION_LOCK_TTL_SECONDS = 15;
const FARM_ACTION_LOCK_RETRY_MS = 80;
const FARM_ACTION_LOCK_MAX_RETRIES = 15;

interface FarmActionLock {
  key: string;
  token: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireFarmActionLock(userId: number): Promise<FarmActionLock | null> {
  const key = FARM_ACTION_LOCK_KEY(userId);
  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  for (let attempt = 0; attempt < FARM_ACTION_LOCK_MAX_RETRIES; attempt += 1) {
    const locked = await kv.set(key, token, { nx: true, ex: FARM_ACTION_LOCK_TTL_SECONDS });
    if (locked === 'OK') {
      return { key, token };
    }
    await sleep(FARM_ACTION_LOCK_RETRY_MS);
  }

  return null;
}

async function releaseFarmActionLock(lock: FarmActionLock): Promise<void> {
  try {
    const current = await kv.get<string>(lock.key);
    if (current === lock.token) {
      await kv.del(lock.key);
    }
  } catch (error) {
    console.error('Release farm action lock failed:', error);
  }
}

// ---- 冷却检查 ----

/**
 * 检查操作冷却（2秒防连点）
 */
export async function checkActionCooldown(userId: number): Promise<boolean> {
  const key = FARM_COOLDOWN_KEY(userId);
  // SET NX EX - 如果key不存在则设置，带过期时间
  const set = await kv.set(key, 1, { nx: true, ex: ACTION_COOLDOWN_SECONDS });
  return set === 'OK'; // true = 可以操作，false = 冷却中
}

// ---- 农场状态 CRUD ----

/**
 * 获取农场状态（不存在则创建）
 */
export async function getOrCreateFarm(userId: number): Promise<FarmState> {
  const key = FARM_STATE_KEY(userId);
  const existing = await kv.get<FarmState>(key);

  if (existing) {
    const normalized = normalizeFarmState(existing);
    // 惰性刷新状态
    const weather = getTodayWeather(getTodayDateString());
    const now = Date.now();
    // 清理过期buff
    const cleanedBuffs = (normalized.activeBuffs ?? []).filter(b => b.expiresAt > now);
    const cleaned = { ...normalized, activeBuffs: cleanedBuffs };
    const refreshed = refreshFarmState(cleaned, now, weather);
    return refreshed;
  }

  // 新建农场
  const newFarm = createInitialFarmState(userId);
  await kv.set(key, newFarm);
  return newFarm;
}

/**
 * 获取农场状态（不创建）
 */
export async function getFarmState(userId: number): Promise<FarmState | null> {
  const farmState = await kv.get<FarmState>(FARM_STATE_KEY(userId));
  return farmState ? normalizeFarmState(farmState) : null;
}

/**
 * 保存农场状态
 */
async function saveFarmState(farmState: FarmState): Promise<void> {
  await kv.set(FARM_STATE_KEY(farmState.userId), farmState);
}

function isValidPlotIndex(plotIndex: number, plotCount: number): boolean {
  return Number.isInteger(plotIndex) && plotIndex >= 0 && plotIndex < plotCount;
}

function normalizeFarmState(farmState: FarmState): FarmState {
  return {
    ...farmState,
    activeBuffs: farmState.activeBuffs ?? [],
    inventory: farmState.inventory ?? {},
    plots: farmState.plots.map((plot, index) => ({
      ...plot,
      index: Number.isInteger(plot.index) ? plot.index : index,
      pestClearedAt: plot.pestClearedAt ?? null,
    })),
  };
}

// ---- 种植 ----

/**
 * 种植作物（原子操作）
 */
export async function plantCrop(
  userId: number,
  plotIndex: number,
  cropId: CropId,
): Promise<{ success: boolean; message?: string; farmState?: FarmState; newBalance?: number }> {
  const lock = await acquireFarmActionLock(userId);
  if (!lock) {
    return { success: false, message: '操作处理中，请稍后重试' };
  }

  try {
  // 获取当前状态
  const farm = await getOrCreateFarm(userId);
  const now = Date.now();
  const weather = getTodayWeather(getTodayDateString());

  // 验证田地索引
  if (!isValidPlotIndex(plotIndex, farm.plots.length)) {
    return { success: false, message: '无效的田地' };
  }

  // 验证田地空闲
  const plot = farm.plots[plotIndex];
  if (plot.cropId !== null) {
    return { success: false, message: '该田地已有作物' };
  }

  // 验证作物解锁
  if (!farm.unlockedCrops.includes(cropId)) {
    return { success: false, message: '该作物尚未解锁' };
  }

  // 验证作物存在
  const crop = CROPS[cropId];
  if (!crop) {
    return { success: false, message: '未知作物' };
  }

  // 扣除种子费用
  const deductResult = await deductPoints(userId, crop.seedCost, 'exchange', `农场种植: ${crop.name}种子`);
  if (!deductResult.success) {
    return { success: false, message: deductResult.message ?? '积分不足' };
  }

  // 更新田地状态
  farm.plots[plotIndex] = {
    index: plotIndex,
    cropId,
    plantedAt: now,
    lastWateredAt: now, // 种植时算一次浇水
    waterCount: 1,
    hasPest: false,
    pestAppearedAt: null,
    pestClearedAt: null,
    stage: 'seed',
    yieldMultiplier: 1.0,
  };
  farm.lastUpdatedAt = now;

  // 保存
  try {
    await saveFarmState(farm);
  } catch (saveError) {
    console.error('Farm plant save failed, refunding seed cost:', saveError);
    try {
      await addPoints(userId, crop.seedCost, 'exchange', `农场种植失败退款: ${crop.name}种子`);
    } catch (refundError) {
      console.error('Farm plant refund failed:', refundError);
    }
    return { success: false, message: '种植失败，请稍后重试' };
  }

  return {
    success: true,
    farmState: refreshFarmState(farm, now, weather),
    newBalance: deductResult.balance,
  };
  } finally {
    await releaseFarmActionLock(lock);
  }
}

// ---- 浇水 ----

/**
 * 给指定田地浇水
 */
export async function waterPlot(
  userId: number,
  plotIndex: number,
): Promise<{ success: boolean; message?: string; farmState?: FarmState }> {
  const lock = await acquireFarmActionLock(userId);
  if (!lock) {
    return { success: false, message: '操作处理中，请稍后重试' };
  }

  try {
  const farm = await getOrCreateFarm(userId);
  const now = Date.now();
  const weather = getTodayWeather(getTodayDateString());

  if (!isValidPlotIndex(plotIndex, farm.plots.length)) {
    return { success: false, message: '无效的田地' };
  }

  const plot = farm.plots[plotIndex];
  if (!plot.cropId || !plot.plantedAt) {
    return { success: false, message: '该田地没有作物' };
  }

  // 刷新状态检查枯萎
  const computed = computePlotState(plot, now, weather, userId);
  if (computed.stage === 'withered') {
    return { success: false, message: '作物已枯萎，请铲除' };
  }

  if (computed.stage === 'mature') {
    return { success: false, message: '作物已成熟，无需浇水' };
  }

  if (!computed.needsWater) {
    return { success: false, message: '当前无需浇水' };
  }

  // 更新浇水时间
  farm.plots[plotIndex] = {
    ...plot,
    lastWateredAt: now,
    waterCount: plot.waterCount + 1,
    stage: computed.stage,
    hasPest: computed.hasPest,
    pestAppearedAt: computed.pestAppearedAt,
    yieldMultiplier: computed.yieldMultiplier,
  };
  farm.lastUpdatedAt = now;

  await saveFarmState(farm);

  return {
    success: true,
    farmState: refreshFarmState(farm, now, weather),
  };
  } finally {
    await releaseFarmActionLock(lock);
  }
}

/**
 * 一键浇水：给所有需要浇水的田地浇水
 */
export async function waterAllPlots(
  userId: number,
): Promise<{ success: boolean; wateredCount: number; message?: string; farmState?: FarmState }> {
  const lock = await acquireFarmActionLock(userId);
  if (!lock) {
    return { success: false, wateredCount: 0, message: '操作处理中，请稍后重试' };
  }

  try {
  const farm = await getOrCreateFarm(userId);
  const now = Date.now();
  const weather = getTodayWeather(getTodayDateString());

  let wateredCount = 0;

  for (let i = 0; i < farm.plots.length; i++) {
    const plot = farm.plots[i];
    if (!plot.cropId || !plot.plantedAt) continue;

    const computed = computePlotState(plot, now, weather, userId);
    if (computed.stage === 'withered' || computed.stage === 'mature') continue;
    if (!computed.needsWater) continue;

    farm.plots[i] = {
      ...plot,
      lastWateredAt: now,
      waterCount: plot.waterCount + 1,
      stage: computed.stage,
      hasPest: computed.hasPest,
      pestAppearedAt: computed.pestAppearedAt,
      yieldMultiplier: computed.yieldMultiplier,
    };
    wateredCount++;
  }

  if (wateredCount > 0) {
    farm.lastUpdatedAt = now;
    await saveFarmState(farm);
  }

  return {
    success: true,
    wateredCount,
    farmState: refreshFarmState(farm, now, weather),
  };
  } finally {
    await releaseFarmActionLock(lock);
  }
}

// ---- 收获 ----

/**
 * 收获指定田地的作物
 */
export async function harvestPlot(
  userId: number,
  plotIndex: number,
): Promise<{
  success: boolean;
  message?: string;
  farmState?: FarmState;
  harvest?: HarvestDetail;
  pointsEarned?: number;
  newBalance?: number;
  dailyEarned?: number;
  limitReached?: boolean;
  expGained?: number;
  levelUp?: boolean;
  newLevel?: FarmLevel;
}> {
  const lock = await acquireFarmActionLock(userId);
  if (!lock) {
    return { success: false, message: '操作处理中，请稍后重试' };
  }

  try {
  const farm = await getOrCreateFarm(userId);
  const farmBeforeHarvest = JSON.parse(JSON.stringify(farm)) as FarmState;
  const now = Date.now();
  const weather = getTodayWeather(getTodayDateString());

  if (!isValidPlotIndex(plotIndex, farm.plots.length)) {
    return { success: false, message: '无效的田地' };
  }

  const plot = farm.plots[plotIndex];
  if (!plot.cropId || !plot.plantedAt) {
    return { success: false, message: '该田地没有作物' };
  }

  // 刷新计算阶段
  const computed = computePlotState(plot, now, weather, userId);
  if (computed.stage === 'withered') {
    return { success: false, message: '作物已枯萎，请铲除' };
  }
  if (computed.stage !== 'mature') {
    return { success: false, message: '作物尚未成熟' };
  }

  const crop = CROPS[plot.cropId];
  const { yield: harvestYield } = computeHarvestYield(
    { ...plot, stage: computed.stage, hasPest: computed.hasPest, pestAppearedAt: computed.pestAppearedAt },
    now, weather,
  );

  const missedWaterCycles = computeMissedWaterCycles(
    plot.lastWateredAt,
    plot.plantedAt,
    now,
    plot.cropId,
  );
  const waterMultiplier = computeWaterYieldMultiplier(missedWaterCycles);

  // 经验奖励
  const expGained = crop.expReward;
  farm.exp += expGained;
  farm.totalHarvests += 1;

  // 清空田地
  farm.plots[plotIndex] = createEmptyPlot(plotIndex);
  farm.lastUpdatedAt = now;

  // 检查升级
  const levelResult = checkLevelUp(farm);
  if (levelResult.leveledUp) {
    Object.assign(farm, levelResult.newState);
  }

  // 先持久化田地与经验状态，避免发分成功但田地未清空导致重复领取
  await saveFarmState(farm);

  // 发放积分（受每日上限约束）
  const dailyLimit = await getDailyPointsLimit();
  let pointsResult: Awaited<ReturnType<typeof addGamePointsWithLimit>>;
  try {
    pointsResult = await addGamePointsWithLimit(
      userId, harvestYield, dailyLimit, 'game_play', `农场收获: ${crop.name}`,
    );
  } catch (pointsError) {
    console.error('Farm harvest points settlement failed, rolling back farm state:', pointsError);
    try {
      await saveFarmState(farmBeforeHarvest);
    } catch (rollbackError) {
      console.error('Farm harvest rollback failed:', rollbackError);
    }
    return { success: false, message: '积分结算失败，请稍后重试' };
  }

  farm.totalEarnings += pointsResult.pointsEarned;
  // totalEarnings 仅用于展示统计，写回失败不影响主流程
  try {
    await saveFarmState(farm);
  } catch (statsSaveError) {
    console.error('Farm harvest save totalEarnings failed:', statsSaveError);
  }

  // 构建收获详情
  const weatherConfig = WEATHERS[weather];
  const harvest: HarvestDetail = {
    cropId: plot.cropId,
    cropName: crop.name,
    cropIcon: crop.icon,
    baseYield: crop.baseYield,
    weatherBonus: Math.round((weatherConfig.yieldModifier - 1) * 100),
    waterBonus: Math.round((waterMultiplier - 1) * 100),
    pestPenalty: computed.hasPest ? Math.round((1 - computePestYieldMultiplier(computed.pestAppearedAt, now)) * 100) : 0,
    finalYield: harvestYield,
    expGained,
  };

  return {
    success: true,
    farmState: refreshFarmState(farm, now, weather),
    harvest,
    pointsEarned: pointsResult.pointsEarned,
    newBalance: pointsResult.balance,
    dailyEarned: pointsResult.dailyEarned,
    limitReached: pointsResult.limitReached,
    expGained,
    levelUp: levelResult.leveledUp,
    newLevel: levelResult.leveledUp ? levelResult.newLevel : undefined,
  };
  } finally {
    await releaseFarmActionLock(lock);
  }
}

// ---- 除虫 ----

/**
 * 清除指定田地的害虫
 */
export async function removePest(
  userId: number,
  plotIndex: number,
): Promise<{ success: boolean; message?: string; farmState?: FarmState }> {
  const lock = await acquireFarmActionLock(userId);
  if (!lock) {
    return { success: false, message: '操作处理中，请稍后重试' };
  }

  try {
  const farm = await getOrCreateFarm(userId);
  const now = Date.now();
  const weather = getTodayWeather(getTodayDateString());

  if (!isValidPlotIndex(plotIndex, farm.plots.length)) {
    return { success: false, message: '无效的田地' };
  }

  const plot = farm.plots[plotIndex];
  if (!plot.cropId) {
    return { success: false, message: '该田地没有作物' };
  }

  // 刷新检查是否真的有害虫
  const computed = computePlotState(plot, now, weather, userId);
  if (!computed.hasPest) {
    return { success: false, message: '该田地没有害虫' };
  }

  const afterClear = computePlotState(
    {
      ...plot,
      hasPest: false,
      pestAppearedAt: null,
      pestClearedAt: now,
    },
    now,
    weather,
    userId,
  );

  // 清除害虫
  farm.plots[plotIndex] = {
    ...plot,
    hasPest: false,
    pestAppearedAt: null,
    pestClearedAt: now,
    stage: afterClear.stage,
    yieldMultiplier: afterClear.yieldMultiplier,
  };
  farm.lastUpdatedAt = now;

  await saveFarmState(farm);

  return {
    success: true,
    farmState: refreshFarmState(farm, now, weather),
  };
  } finally {
    await releaseFarmActionLock(lock);
  }
}

// ---- 铲除枯萎作物 ----

/**
 * 铲除枯萎或不要的作物
 */
export async function removeCrop(
  userId: number,
  plotIndex: number,
): Promise<{ success: boolean; message?: string; farmState?: FarmState }> {
  const lock = await acquireFarmActionLock(userId);
  if (!lock) {
    return { success: false, message: '操作处理中，请稍后重试' };
  }

  try {
  const farm = await getOrCreateFarm(userId);
  const now = Date.now();
  const weather = getTodayWeather(getTodayDateString());

  if (!isValidPlotIndex(plotIndex, farm.plots.length)) {
    return { success: false, message: '无效的田地' };
  }

  const plot = farm.plots[plotIndex];
  if (!plot.cropId) {
    return { success: false, message: '该田地没有作物' };
  }

  // 清空田地
  farm.plots[plotIndex] = createEmptyPlot(plotIndex);
  farm.lastUpdatedAt = now;

  await saveFarmState(farm);

  return {
    success: true,
    farmState: refreshFarmState(farm, now, weather),
  };
  } finally {
    await releaseFarmActionLock(lock);
  }
}

// ---- 一键铲除枯萎作物 ----

/**
 * 铲除所有枯萎作物
 */
export async function removeAllWitheredCrops(
  userId: number,
): Promise<{ success: boolean; removedCount: number; farmState?: FarmState }> {
  const lock = await acquireFarmActionLock(userId);
  if (!lock) {
    return { success: false, removedCount: 0 };
  }

  try {
  const farm = await getOrCreateFarm(userId);
  const now = Date.now();
  const weather = getTodayWeather(getTodayDateString());

  let removedCount = 0;

  for (let i = 0; i < farm.plots.length; i++) {
    const plot = farm.plots[i];
    if (!plot.cropId || !plot.plantedAt) continue;

    const computed = computePlotState(plot, now, weather, userId);
    if (computed.stage !== 'withered') continue;

    farm.plots[i] = createEmptyPlot(i);
    removedCount++;
  }

  if (removedCount > 0) {
    farm.lastUpdatedAt = now;
    await saveFarmState(farm);
  }

  return {
    success: true,
    removedCount,
    farmState: refreshFarmState(farm, now, weather),
  };
  } finally {
    await releaseFarmActionLock(lock);
  }
}

// ---- 一键收获 ----

/**
 * 收获所有成熟作物
 */
export async function harvestAllPlots(
  userId: number,
): Promise<{
  success: boolean;
  message?: string;
  harvests: HarvestDetail[];
  totalPointsEarned: number;
  harvestedCount: number;
  newBalance: number;
  dailyEarned: number;
  limitReached: boolean;
  expGained: number;
  levelUp: boolean;
  newLevel?: FarmLevel;
  farmState?: FarmState;
}> {
  const lock = await acquireFarmActionLock(userId);
  if (!lock) {
    return {
      success: false,
      message: '操作处理中，请稍后重试',
      harvests: [],
      totalPointsEarned: 0,
      harvestedCount: 0,
      newBalance: 0,
      dailyEarned: 0,
      limitReached: false,
      expGained: 0,
      levelUp: false,
    };
  }

  try {
  const farm = await getOrCreateFarm(userId);
  const farmBeforeHarvest = JSON.parse(JSON.stringify(farm)) as FarmState;
  const now = Date.now();
  const weather = getTodayWeather(getTodayDateString());
  const weatherConfig = WEATHERS[weather];

  const harvests: HarvestDetail[] = [];
  let totalExpectedYield = 0;
  let totalExpGained = 0;

  for (let i = 0; i < farm.plots.length; i++) {
    const plot = farm.plots[i];
    if (!plot.cropId || !plot.plantedAt) continue;

    const computed = computePlotState(plot, now, weather, userId);
    if (computed.stage !== 'mature') continue;

    const crop = CROPS[plot.cropId];
    const { yield: harvestYield } = computeHarvestYield(
      { ...plot, stage: computed.stage, hasPest: computed.hasPest, pestAppearedAt: computed.pestAppearedAt },
      now, weather,
    );

    const missedWaterCycles = computeMissedWaterCycles(
      plot.lastWateredAt,
      plot.plantedAt,
      now,
      plot.cropId,
    );
    const waterMultiplier = computeWaterYieldMultiplier(missedWaterCycles);

    // 经验
    const expGained = crop.expReward;
    farm.exp += expGained;
    farm.totalHarvests += 1;
    totalExpectedYield += harvestYield;
    totalExpGained += expGained;

    // 清空田地
    farm.plots[i] = createEmptyPlot(i);

    // 构建收获详情
    harvests.push({
      cropId: plot.cropId,
      cropName: crop.name,
      cropIcon: crop.icon,
      baseYield: crop.baseYield,
      weatherBonus: Math.round((weatherConfig.yieldModifier - 1) * 100),
      waterBonus: Math.round((waterMultiplier - 1) * 100),
      pestPenalty: computed.hasPest ? Math.round((1 - computePestYieldMultiplier(computed.pestAppearedAt, now)) * 100) : 0,
      finalYield: harvestYield,
      expGained,
    });
  }

  if (harvests.length > 0) {
    farm.lastUpdatedAt = now;

    // 检查升级
    const levelResult = checkLevelUp(farm);
    if (levelResult.leveledUp) {
      Object.assign(farm, levelResult.newState);
    }

    // 先持久化田地与经验状态，避免发分成功但田地未清空导致重复领取
    await saveFarmState(farm);

    const dailyLimit = await getDailyPointsLimit();
    let pointsResult: Awaited<ReturnType<typeof addGamePointsWithLimit>>;
    try {
      pointsResult = await addGamePointsWithLimit(
        userId,
        totalExpectedYield,
        dailyLimit,
        'game_play',
        `农场一键收获: ${harvests.length}块田地`,
      );
    } catch (pointsError) {
      console.error('Farm harvest-all points settlement failed, rolling back farm state:', pointsError);
      try {
        await saveFarmState(farmBeforeHarvest);
      } catch (rollbackError) {
        console.error('Farm harvest-all rollback failed:', rollbackError);
      }
      return {
        success: false,
        message: '积分结算失败，请稍后重试',
        harvests: [],
        totalPointsEarned: 0,
        harvestedCount: 0,
        newBalance: 0,
        dailyEarned: 0,
        limitReached: false,
        expGained: 0,
        levelUp: false,
        farmState: refreshFarmState(farmBeforeHarvest, now, weather),
      };
    }

    farm.totalEarnings += pointsResult.pointsEarned;
    try {
      await saveFarmState(farm);
    } catch (statsSaveError) {
      console.error('Farm harvest-all save totalEarnings failed:', statsSaveError);
    }

    return {
      success: true,
      harvests,
      totalPointsEarned: pointsResult.pointsEarned,
      harvestedCount: harvests.length,
      newBalance: pointsResult.balance,
      dailyEarned: pointsResult.dailyEarned,
      limitReached: pointsResult.limitReached,
      expGained: totalExpGained,
      levelUp: levelResult.leveledUp,
      newLevel: levelResult.leveledUp ? levelResult.newLevel : undefined,
      farmState: refreshFarmState(farm, now, weather),
    };
  }

  return {
    success: false,
    message: '当前没有成熟作物可收获',
    harvests: [],
    totalPointsEarned: 0,
    harvestedCount: 0,
    newBalance: 0,
    dailyEarned: 0,
    limitReached: false,
    expGained: 0,
    levelUp: false,
    farmState: refreshFarmState(farm, now, weather),
  };
  } finally {
    await releaseFarmActionLock(lock);
  }
}
