// src/lib/farm-engine.ts - 农场纯函数引擎（前后端共用）

import seedrandom from 'seedrandom';
import type { CropId, CropStage, WeatherType, PlotState, ComputedPlotState, FarmState, FarmLevel } from './types/farm';
import type { ActiveBuff, BuffContext } from './types/farm-shop';
import {
  CROPS, WEATHERS, FARM_LEVELS,
  PEST_BASE_CHANCE, PEST_CHECK_WINDOW, PEST_YIELD_PENALTY_PER_WINDOW, PEST_MIN_YIELD,
  WATER_MISS_PENALTY, WATER_MISS_WITHER_THRESHOLD,
  getLevelByExp,
} from './farm-config';

const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function getChinaDateStringByTimestamp(timestamp: number): string {
  const chinaTime = new Date(timestamp + CHINA_TZ_OFFSET_MS);
  const year = chinaTime.getUTCFullYear();
  const month = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(chinaTime.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getChinaDayStartUtcTimestamp(timestamp: number): number {
  const chinaTimestamp = timestamp + CHINA_TZ_OFFSET_MS;
  const dayStartInChina = Math.floor(chinaTimestamp / DAY_MS) * DAY_MS;
  return dayStartInChina - CHINA_TZ_OFFSET_MS;
}

function sumDailySegments(
  startTime: number,
  endTime: number,
  reducer: (segmentStart: number, segmentEnd: number, weather: WeatherType) => number,
): number {
  if (endTime <= startTime) return 0;

  let cursor = startTime;
  let sum = 0;
  while (cursor < endTime) {
    const dayStart = getChinaDayStartUtcTimestamp(cursor);
    const dayEnd = dayStart + DAY_MS;
    const segmentEnd = Math.min(endTime, dayEnd);
    const weather = getWeatherForDate(getChinaDateStringByTimestamp(cursor));
    sum += reducer(cursor, segmentEnd, weather);
    cursor = segmentEnd;
  }
  return sum;
}

// ---- Buff 辅助 ----

/**
 * 从 ActiveBuff[] 构建 BuffContext
 */
export function buildBuffContext(activeBuffs: ActiveBuff[] | undefined, now: number): BuffContext | undefined {
  if (!activeBuffs || activeBuffs.length === 0) return undefined;

  const ctx: BuffContext = {};

  for (const buff of activeBuffs) {
    if (buff.expiresAt <= now) continue; // 已过期

    switch (buff.effect) {
      case 'auto_water':
        ctx.autoWater = { activatedAt: buff.activatedAt, expiresAt: buff.expiresAt };
        break;
      case 'pest_shield':
        ctx.pestShield = {
          activatedAt: buff.activatedAt,
          expiresAt: buff.expiresAt,
          reduction: buff.effectValue ?? 0.8,
        };
        break;
      case 'growth_speed':
        ctx.growthSpeed = {
          activatedAt: buff.activatedAt,
          expiresAt: buff.expiresAt,
          multiplier: buff.effectValue ?? 2,
        };
        break;
      case 'yield_bonus':
        ctx.yieldBonus = { multiplier: 1 + (buff.effectValue ?? 0.25) };
        break;
      case 'weather_shield':
        ctx.weatherShield = { active: true };
        break;
      case 'auto_harvest':
        ctx.autoHarvest = { active: true };
        break;
    }
  }

  // 如果没有任何活跃 buff，返回 undefined
  const hasAny = ctx.autoWater || ctx.pestShield || ctx.growthSpeed ||
    ctx.yieldBonus || ctx.weatherShield || ctx.autoHarvest;
  return hasAny ? ctx : undefined;
}

// ---- 天气系统 ----

/**
 * 根据日期确定性生成当天天气
 * 所有玩家同一天看到相同天气
 */
export function getWeatherForDate(dateString: string): WeatherType {
  const rng = seedrandom(`farm-weather-${dateString}`);
  const roll = rng() * 100;

  const weatherTypes: WeatherType[] = ['sunny', 'rainy', 'drought', 'windy', 'foggy'];
  let cumulative = 0;
  for (const type of weatherTypes) {
    cumulative += WEATHERS[type].probability;
    if (roll < cumulative) {
      return type;
    }
  }
  return 'sunny';
}

/**
 * 获取今日天气（中国时区日期字符串）
 */
export function getTodayWeather(todayDateString: string): WeatherType {
  return getWeatherForDate(todayDateString);
}

// ---- 生长计算 ----

/**
 * 计算作物当前生长进度（0~1）
 * 考虑天气对生长速度的影响 + growth_speed buff
 */
export function computeGrowthProgress(
  plantedAt: number,
  now: number,
  cropId: CropId,
  buffCtx?: BuffContext,
): number {
  const crop = CROPS[cropId];
  if (!crop) return 0;

  const growthUnits = sumDailySegments(plantedAt, now, (segmentStart, segmentEnd, weather) => {
    const weatherConfig = WEATHERS[weather];
    let modifier = weatherConfig.growthModifier;

    // growth_speed buff：在 buff 活跃期间额外乘以 multiplier
    if (buffCtx?.growthSpeed) {
      const overlapStart = Math.max(segmentStart, buffCtx.growthSpeed.activatedAt);
      const overlapEnd = Math.min(segmentEnd, buffCtx.growthSpeed.expiresAt);
      if (overlapStart < overlapEnd) {
        // 拆分为 buff 活跃和非活跃两段
        const buffedTime = overlapEnd - overlapStart;
        const unbuffedTime = (segmentEnd - segmentStart) - buffedTime;
        return unbuffedTime * modifier + buffedTime * modifier * buffCtx.growthSpeed.multiplier;
      }
    }

    return (segmentEnd - segmentStart) * modifier;
  });
  const progress = Math.min(1, Math.max(0, growthUnits / crop.growthTime));
  return progress;
}

/**
 * 根据进度确定生长阶段
 */
export function getStageFromProgress(cropId: CropId, progress: number): CropStage {
  const crop = CROPS[cropId];
  if (!crop) return 'seed';

  const stages = crop.stages;
  // 倒序找到当前阶段
  for (let i = stages.length - 1; i >= 0; i--) {
    if (progress >= stages[i].progressStart) {
      return stages[i].stage;
    }
  }
  return 'seed';
}

/**
 * 计算错过的浇水周期数
 */
export function computeMissedWaterCycles(
  lastWateredAt: number | null,
  plantedAt: number,
  now: number,
  cropId: CropId,
  buffCtx?: BuffContext,
): number {
  const crop = CROPS[cropId];
  if (!crop) return 0;

  const referenceTime = lastWateredAt ?? plantedAt;
  const nonAutoWaterElapsed = sumDailySegments(referenceTime, now, (segmentStart, segmentEnd, weather) => {
    // 天气自动浇水时段不计入
    if (WEATHERS[weather].autoWater) return 0;

    // auto_water buff 活跃时段不计入
    if (buffCtx?.autoWater) {
      const overlapStart = Math.max(segmentStart, buffCtx.autoWater.activatedAt);
      const overlapEnd = Math.min(segmentEnd, buffCtx.autoWater.expiresAt);
      if (overlapStart < overlapEnd) {
        const buffedTime = overlapEnd - overlapStart;
        return (segmentEnd - segmentStart) - buffedTime;
      }
    }

    return segmentEnd - segmentStart;
  });

  if (nonAutoWaterElapsed <= crop.waterInterval) return 0;

  return Math.floor(nonAutoWaterElapsed / crop.waterInterval);
}

/**
 * 计算浇水相关的产量倍率
 */
export function computeWaterYieldMultiplier(missedCycles: number): number {
  if (missedCycles <= 0) return 1.0;
  // 每个错过周期按配置比例减产
  const penalty = 1 - (missedCycles * WATER_MISS_PENALTY);
  return Math.max(0, penalty);
}

/**
 * 判断是否需要浇水
 */
export function needsWater(
  lastWateredAt: number | null,
  plantedAt: number,
  now: number,
  cropId: CropId,
  weather: WeatherType,
  buffCtx?: BuffContext,
): boolean {
  if (WEATHERS[weather].autoWater) return false;

  // auto_water buff 活跃时不需要浇水
  if (buffCtx?.autoWater && now < buffCtx.autoWater.expiresAt && now >= buffCtx.autoWater.activatedAt) {
    return false;
  }

  const crop = CROPS[cropId];
  if (!crop) return false;

  const referenceTime = lastWateredAt ?? plantedAt;
  const nonAutoWaterElapsed = sumDailySegments(referenceTime, now, (segmentStart, segmentEnd, segmentWeather) => {
    if (WEATHERS[segmentWeather].autoWater) return 0;

    // auto_water buff 活跃时段不计入
    if (buffCtx?.autoWater) {
      const overlapStart = Math.max(segmentStart, buffCtx.autoWater.activatedAt);
      const overlapEnd = Math.min(segmentEnd, buffCtx.autoWater.expiresAt);
      if (overlapStart < overlapEnd) {
        const buffedTime = overlapEnd - overlapStart;
        return (segmentEnd - segmentStart) - buffedTime;
      }
    }

    return segmentEnd - segmentStart;
  });
  return nonAutoWaterElapsed >= crop.waterInterval;
}

// ---- 害虫系统 ----

/**
 * 确定性判断某个时间窗口是否出现害虫
 * 使用 userId + 时间窗口索引 作为种子
 */
export function shouldPestAppear(
  userId: number,
  plotIndex: number,
  plantedAt: number,
  now: number,
  _weather: WeatherType,
  pestClearedAt: number | null = null,
  buffCtx?: BuffContext,
): boolean {
  const elapsed = now - plantedAt;
  const maxWindow = Math.floor(elapsed / PEST_CHECK_WINDOW);
  if (maxWindow < 1) return false; // 种下第一个10分钟窗口不出虫

  const startWindow = pestClearedAt && pestClearedAt >= plantedAt
    ? Math.floor((pestClearedAt - plantedAt) / PEST_CHECK_WINDOW) + 1
    : 1;

  for (let w = startWindow; w <= maxWindow; w++) {
    const windowTime = plantedAt + w * PEST_CHECK_WINDOW;
    const windowWeather = getWeatherForDate(getChinaDateStringByTimestamp(windowTime));
    let effectiveChance = PEST_BASE_CHANCE * WEATHERS[windowWeather].pestModifier;

    // pest_shield buff：在 buff 活跃期间降低概率
    if (buffCtx?.pestShield && windowTime >= buffCtx.pestShield.activatedAt && windowTime < buffCtx.pestShield.expiresAt) {
      effectiveChance *= (1 - buffCtx.pestShield.reduction);
    }

    const seed = `pest-${userId}-${plotIndex}-${plantedAt}-${w}`;
    const rng = seedrandom(seed);
    if (rng() < effectiveChance) {
      return true;
    }
  }
  return false;
}

/**
 * 计算害虫最早出现时间
 */
export function getPestAppearTime(
  userId: number,
  plotIndex: number,
  plantedAt: number,
  now: number,
  _weather: WeatherType,
  pestClearedAt: number | null = null,
  buffCtx?: BuffContext,
): number | null {
  const elapsed = now - plantedAt;
  const maxWindow = Math.floor(elapsed / PEST_CHECK_WINDOW);
  if (maxWindow < 1) return null;

  const startWindow = pestClearedAt && pestClearedAt >= plantedAt
    ? Math.floor((pestClearedAt - plantedAt) / PEST_CHECK_WINDOW) + 1
    : 1;

  for (let w = startWindow; w <= maxWindow; w++) {
    const windowTime = plantedAt + w * PEST_CHECK_WINDOW;
    const windowWeather = getWeatherForDate(getChinaDateStringByTimestamp(windowTime));
    let effectiveChance = PEST_BASE_CHANCE * WEATHERS[windowWeather].pestModifier;

    // pest_shield buff
    if (buffCtx?.pestShield && windowTime >= buffCtx.pestShield.activatedAt && windowTime < buffCtx.pestShield.expiresAt) {
      effectiveChance *= (1 - buffCtx.pestShield.reduction);
    }

    const seed = `pest-${userId}-${plotIndex}-${plantedAt}-${w}`;
    const rng = seedrandom(seed);
    if (rng() < effectiveChance) {
      return plantedAt + w * PEST_CHECK_WINDOW;
    }
  }
  return null;
}

/**
 * 计算害虫导致的产量惩罚
 */
export function computePestYieldMultiplier(
  pestAppearedAt: number | null,
  now: number,
): number {
  if (!pestAppearedAt) return 1.0;

  const elapsed = now - pestAppearedAt;
  const windowsPassed = Math.floor(elapsed / PEST_CHECK_WINDOW);
  const penalty = 1 - (windowsPassed * PEST_YIELD_PENALTY_PER_WINDOW);
  return Math.max(PEST_MIN_YIELD, penalty);
}

// ---- 综合计算 ----

/**
 * 计算单块田地的完整展示状态
 */
export function computePlotState(
  plot: PlotState,
  now: number,
  weather: WeatherType,
  userId: number,
  buffCtx?: BuffContext,
): ComputedPlotState {
  // 空地
  if (!plot.cropId || !plot.plantedAt) {
    return {
      ...plot,
      growthProgress: 0,
      needsWater: false,
      missedWaterCycles: 0,
      timeToNextStage: 0,
      timeToMature: 0,
      estimatedYield: 0,
    };
  }

  // 已枯萎
  if (plot.stage === 'withered') {
    return {
      ...plot,
      growthProgress: 0,
      needsWater: false,
      missedWaterCycles: WATER_MISS_WITHER_THRESHOLD,
      timeToNextStage: 0,
      timeToMature: 0,
      estimatedYield: 0,
    };
  }

  const crop = CROPS[plot.cropId];
  const weatherConfig = WEATHERS[weather];

  // 生长进度（传入 buffCtx）
  const growthProgress = computeGrowthProgress(plot.plantedAt, now, plot.cropId, buffCtx);
  const currentStage = getStageFromProgress(plot.cropId, growthProgress);

  // 浇水状态（传入 buffCtx）
  const missedCycles = computeMissedWaterCycles(
    plot.lastWateredAt, plot.plantedAt, now, plot.cropId, buffCtx
  );

  // 检查枯萎（成熟作物免疫枯萎，只会减产不会枯死）
  const isWithered = currentStage !== 'mature' && missedCycles >= WATER_MISS_WITHER_THRESHOLD;
  if (isWithered) {
    return {
      ...plot,
      stage: 'withered',
      growthProgress,
      needsWater: false,
      missedWaterCycles: missedCycles,
      timeToNextStage: 0,
      timeToMature: 0,
      estimatedYield: 0,
      yieldMultiplier: 0,
    };
  }

  // 害虫检测（传入 buffCtx）
  const hasPest = plot.hasPest || (
    currentStage !== 'mature' &&
    shouldPestAppear(userId, plot.index, plot.plantedAt, now, weather, plot.pestClearedAt ?? null, buffCtx)
  );
  const pestTime = hasPest
    ? (plot.pestAppearedAt ?? getPestAppearTime(
      userId,
      plot.index,
      plot.plantedAt,
      now,
      weather,
      plot.pestClearedAt ?? null,
      buffCtx,
    ))
    : null;

  // 产量计算
  const waterMultiplier = computeWaterYieldMultiplier(missedCycles);
  const pestMultiplier = computePestYieldMultiplier(pestTime, now);

  // weather_shield buff：负面天气产量倍率归1
  let weatherYieldMod = weatherConfig.yieldModifier;
  if (buffCtx?.weatherShield?.active && weatherYieldMod < 1) {
    weatherYieldMod = 1;
  }

  let totalYieldMultiplier = waterMultiplier * pestMultiplier * weatherYieldMod;

  // yield_bonus buff
  if (buffCtx?.yieldBonus) {
    totalYieldMultiplier *= buffCtx.yieldBonus.multiplier;
  }

  const estimatedYieldRaw = Math.floor(crop.baseYield * totalYieldMultiplier);
  const estimatedYield = currentStage === 'mature'
    ? Math.max(1, estimatedYieldRaw)
    : Math.max(0, estimatedYieldRaw);

  const waterNeed = !weatherConfig.autoWater && needsWater(
    plot.lastWateredAt, plot.plantedAt, now, plot.cropId, weather, buffCtx
  );

  // 时间估算（考虑 growth_speed buff 当前效果）
  const currentGrowthUnits = growthProgress * crop.growthTime;
  const remainingGrowthUnits = Math.max(0, crop.growthTime - currentGrowthUnits);
  let effectiveGrowthMod = weatherConfig.growthModifier;
  if (buffCtx?.growthSpeed && now < buffCtx.growthSpeed.expiresAt && now >= buffCtx.growthSpeed.activatedAt) {
    effectiveGrowthMod *= buffCtx.growthSpeed.multiplier;
  }
  const timeToMature = currentStage === 'mature'
    ? 0
    : Math.max(0, remainingGrowthUnits / effectiveGrowthMod);

  // 找下一阶段
  let timeToNextStage = 0;
  const stageIndex = crop.stages.findIndex(s => s.stage === currentStage);
  if (stageIndex < crop.stages.length - 1) {
    const nextStageProgress = crop.stages[stageIndex + 1].progressStart;
    const nextStageGrowthUnits = nextStageProgress * crop.growthTime;
    const deltaGrowthUnits = Math.max(0, nextStageGrowthUnits - currentGrowthUnits);
    timeToNextStage = Math.max(0, deltaGrowthUnits / effectiveGrowthMod);
  }

  return {
    ...plot,
    stage: currentStage,
    hasPest,
    pestAppearedAt: pestTime,
    growthProgress,
    needsWater: waterNeed,
    missedWaterCycles: missedCycles,
    timeToNextStage,
    timeToMature,
    estimatedYield,
    yieldMultiplier: totalYieldMultiplier,
  };
}

/**
 * 计算收获产出
 */
export function computeHarvestYield(
  plot: PlotState,
  now: number,
  weather: WeatherType,
  buffCtx?: BuffContext,
): { yield: number; yieldMultiplier: number } {
  if (!plot.cropId || plot.stage !== 'mature') {
    return { yield: 0, yieldMultiplier: 0 };
  }

  const crop = CROPS[plot.cropId];
  const weatherConfig = WEATHERS[weather];

  const missedCycles = computeMissedWaterCycles(
    plot.lastWateredAt, plot.plantedAt!, now, plot.cropId, buffCtx
  );
  const waterMultiplier = computeWaterYieldMultiplier(missedCycles);

  const pestMultiplier = plot.hasPest
    ? computePestYieldMultiplier(plot.pestAppearedAt, now)
    : 1.0;

  // weather_shield buff：负面天气产量倍率归1
  let weatherYieldMod = weatherConfig.yieldModifier;
  if (buffCtx?.weatherShield?.active && weatherYieldMod < 1) {
    weatherYieldMod = 1;
  }

  let totalMultiplier = waterMultiplier * pestMultiplier * weatherYieldMod;

  // yield_bonus buff
  if (buffCtx?.yieldBonus) {
    totalMultiplier *= buffCtx.yieldBonus.multiplier;
  }

  const finalYield = Math.max(1, Math.floor(crop.baseYield * totalMultiplier));

  return { yield: finalYield, yieldMultiplier: totalMultiplier };
}

// ---- 农场状态刷新 ----

/**
 * 刷新农场所有田地的状态（惰性计算）
 * 前端用于展示，后端用于验证
 */
export function refreshFarmState(
  farmState: FarmState,
  now: number,
  weather: WeatherType,
): FarmState {
  // 构建 buff 上下文
  const buffCtx = buildBuffContext(farmState.activeBuffs, now);

  // 清理过期 buff
  const cleanedBuffs = (farmState.activeBuffs ?? []).filter(b => b.expiresAt > now);

  const updatedPlots = farmState.plots.map(plot => {
    if (!plot.cropId || !plot.plantedAt) return plot;

    const computed = computePlotState(plot, now, weather, farmState.userId, buffCtx);

    return {
      ...plot,
      stage: computed.stage,
      hasPest: computed.hasPest,
      pestAppearedAt: computed.pestAppearedAt,
      yieldMultiplier: computed.yieldMultiplier,
    };
  });

  return {
    ...farmState,
    plots: updatedPlots,
    activeBuffs: cleanedBuffs,
    lastUpdatedAt: now,
  };
}

// ---- 农场创建 ----

/**
 * 创建空白田地
 */
export function createEmptyPlot(index: number): PlotState {
  return {
    index,
    cropId: null,
    plantedAt: null,
    lastWateredAt: null,
    waterCount: 0,
    hasPest: false,
    pestAppearedAt: null,
    pestClearedAt: null,
    stage: 'seed',
    yieldMultiplier: 1.0,
  };
}

/**
 * 创建初始农场状态
 */
export function createInitialFarmState(userId: number): FarmState {
  const level: FarmLevel = 1;
  const plotCount = FARM_LEVELS[level].plotCount;
  const plots = Array.from({ length: plotCount }, (_, i) => createEmptyPlot(i));

  return {
    userId,
    level,
    exp: 0,
    plots,
    unlockedCrops: [...FARM_LEVELS[1].unlockedCrops],
    totalHarvests: 0,
    totalEarnings: 0,
    lastUpdatedAt: Date.now(),
    createdAt: Date.now(),
  };
}

/**
 * 检查经验是否够升级，返回升级后的状态
 */
export function checkLevelUp(farmState: FarmState): {
  leveledUp: boolean;
  newLevel: FarmLevel;
  newState: FarmState;
} {
  const newLevel = getLevelByExp(farmState.exp);
  if (newLevel <= farmState.level) {
    return { leveledUp: false, newLevel: farmState.level, newState: farmState };
  }

  // 解锁新作物
  const allUnlockedCrops: CropId[] = [];
  for (let l = 1; l <= newLevel; l++) {
    allUnlockedCrops.push(...FARM_LEVELS[l as FarmLevel].unlockedCrops);
  }

  // 扩展田地
  const newPlotCount = FARM_LEVELS[newLevel].plotCount;
  const currentPlots = [...farmState.plots];
  while (currentPlots.length < newPlotCount) {
    currentPlots.push(createEmptyPlot(currentPlots.length));
  }

  return {
    leveledUp: true,
    newLevel,
    newState: {
      ...farmState,
      level: newLevel,
      plots: currentPlots,
      unlockedCrops: allUnlockedCrops,
    },
  };
}
