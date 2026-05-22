// 农场 v1.2 纯函数引擎

import seedrandom from 'seedrandom';
import type {
  CropIdV2, FertilizerType, Quality, Season, WeatherV2, CropInstance,
  CropStageV2, FarmStateV2, ComputedLand, LandPlot, ProtectionBuffs,
} from '@/lib/types/farm-v2';
import {
  CROPS_V2, FERTILIZERS, NO_FERTILIZER_RATES, SEASON_MODIFIERS, WEATHERS_V2,
  SEASON_WEATHER_PROB, WATER_MISS_MUL, WATER_QUALITY_PENALTY, PERFECT_CARE_BONUS,
  OVERRIPE_TIERS, QUALITY_MULTIPLIERS, SEASON_EPOCH_DATE,
} from './config';

const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 获取中国时区时间字符串 YYYY-MM-DD */
export function getChinaDateString(ts: number): string {
  const d = new Date(ts + CHINA_TZ_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 中国时区今日 0 点的 UTC 时间戳 */
export function getChinaMidnight(ts: number): number {
  const day = Math.floor((ts + CHINA_TZ_OFFSET_MS) / (24 * 60 * 60 * 1000));
  return day * 24 * 60 * 60 * 1000 - CHINA_TZ_OFFSET_MS;
}

/** 计算某时刻所属的季节 */
export function getCurrentSeason(ts: number): Season {
  const epoch = parseEpochDate(SEASON_EPOCH_DATE);
  const seasonIndex = Math.floor((getChinaMidnight(ts) - epoch) / WEEK_MS);
  const arr: Season[] = ['spring', 'summer', 'autumn', 'winter'];
  const i = ((seasonIndex % 4) + 4) % 4;
  return arr[i];
}

/** 距离下次换季的毫秒 */
export function getNextSeasonChangeMs(now: number): number {
  const epoch = parseEpochDate(SEASON_EPOCH_DATE);
  const elapsed = getChinaMidnight(now) - epoch;
  const currentWeek = Math.floor(elapsed / WEEK_MS);
  const nextSeasonStart = epoch + (currentWeek + 1) * WEEK_MS;
  return Math.max(0, nextSeasonStart - now);
}

function parseEpochDate(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  // 中国时区 0 点
  return Date.UTC(y, m - 1, d) - CHINA_TZ_OFFSET_MS;
}

/** 距离下一次中国时区 0 点的毫秒数 */
export function getNextDailyResetMs(now: number): number {
  const today = getChinaMidnight(now);
  return Math.max(0, today + 24 * 60 * 60 * 1000 - now);
}

/** 计算实际成长时间（毫秒） */
export function computeActualGrowthMs(cropId: CropIdV2, season: Season, fert: FertilizerType): number {
  const crop = CROPS_V2[cropId];
  const seasonFactor = SEASON_MODIFIERS[season].growth;
  const fertFactor = fert ? FERTILIZERS[fert].growthFactor : 1;
  return Math.round(crop.growthMinutes * seasonFactor * fertFactor * 60 * 1000);
}

/** 计算实际浇水间隔（毫秒） */
export function computeActualWaterIntervalMs(cropId: CropIdV2, season: Season, weather: WeatherV2): number {
  const crop = CROPS_V2[cropId];
  const seasonFactor = SEASON_MODIFIERS[season].water;
  const weatherFactor = WEATHERS_V2[weather].waterFactor;
  return Math.round(crop.waterIntervalMinutes * seasonFactor * weatherFactor * 60 * 1000);
}

/** 计算作物当前阶段（基于成长进度） */
export function computeCropStage(progress: number): CropStageV2 {
  if (progress >= 1) return 'mature';
  if (progress >= 0.5) return 'growing';
  if (progress >= 0.2) return 'sprout';
  return 'seed';
}

/** 计算成长进度 0..1 */
export function computeGrowthProgress(crop: CropInstance, now: number): number {
  if (now >= crop.matureAt) return 1;
  const total = crop.matureAt - crop.plantedAt;
  if (total <= 0) return 1;
  return Math.max(0, (now - crop.plantedAt) / total);
}

/** 计算缺水次数变化（懒结算） */
export function computeWaterMissesAfterWindow(
  crop: CropInstance,
  intervalMs: number,
  now: number,
): { newMissCount: number; newNextDue: number; newLastWater: number } {
  // 仅未成熟期间累积缺水
  const checkUntil = Math.min(now, crop.matureAt);
  let nextDue = crop.nextWaterDueAt;
  let missCount = crop.waterMissCount;
  while (checkUntil > nextDue && missCount < 3) {
    missCount += 1;
    nextDue += intervalMs;
  }
  return { newMissCount: missCount, newNextDue: nextDue, newLastWater: crop.lastWaterAt };
}

/** 缺水收益系数 */
export function getWaterPenaltyMul(missCount: number): number {
  if (missCount >= 3) return 0;
  return WATER_MISS_MUL[missCount] ?? 0;
}

/** 过熟系数 */
export function computeOverripeFactor(crop: CropInstance, now: number): number {
  if (now < crop.matureAt) return 1;
  const hours = (now - crop.matureAt) / (60 * 60 * 1000);
  for (const [tierH, factor] of OVERRIPE_TIERS) {
    if (hours <= tierH) return factor;
  }
  return 0;
}

/** 完美照顾判定 */
export function isPerfectCare(crop: CropInstance, now: number): boolean {
  return crop.waterMissCount === 0
    && crop.stolenCount === 0
    && now < crop.matureAt + 12 * 60 * 60 * 1000;
}

/** 品质概率：返回归一化后的 [普通, 银, 金] */
export function rollQualityRates(
  fert: FertilizerType,
  missCount: number,
  perfect: boolean,
): [number, number, number] {
  const base = fert ? FERTILIZERS[fert].qualityRates : NO_FERTILIZER_RATES;
  let [n, s, g] = base;

  // 缺水惩罚（金/银 乘数）
  if (missCount > 0 && missCount <= 2) {
    const [goldMul, silverMul] = WATER_QUALITY_PENALTY[missCount];
    g = g * goldMul;
    s = s * silverMul;
  } else if (missCount >= 3) {
    return [1, 0, 0];
  }

  // 完美照顾
  if (perfect) {
    s += PERFECT_CARE_BONUS[0];
    g += PERFECT_CARE_BONUS[1];
  }

  // 归一化
  s = Math.max(0, s);
  g = Math.max(0, g);
  n = Math.max(0, 1 - s - g);
  const total = n + s + g;
  if (total <= 0) return [1, 0, 0];
  return [n / total, s / total, g / total];
}

/** 根据概率随机品质 */
export function pickQuality(rates: [number, number, number], rng: () => number): Quality {
  const r = rng();
  if (r < rates[0]) return 'normal';
  if (r < rates[0] + rates[1]) return 'silver';
  return 'gold';
}

/** 计算最终收获积分 */
export function computeFinalYield(
  cropId: CropIdV2,
  quality: Quality,
  missCount: number,
  season: Season,
  overripe: number,
  stolenAmount: number,
): number {
  const base = CROPS_V2[cropId].baseYield;
  const qm = QUALITY_MULTIPLIERS[quality];
  const wm = getWaterPenaltyMul(missCount);
  const sm = SEASON_MODIFIERS[season].yield;
  const raw = base * qm * wm * sm * overripe;
  return Math.max(0, Math.floor(raw) - stolenAmount);
}

/** 加权抽取天气（按 SEASON_WEATHER_PROB 表） */
export function getWeatherForDate(dateStr: string, season: Season): WeatherV2 {
  const rng = seedrandom(`weather:${dateStr}:${season}`);
  const r = rng();
  const dist = SEASON_WEATHER_PROB[season];
  let acc = 0;
  for (const [w, p] of dist) {
    acc += p;
    if (r < acc) return w;
  }
  return dist[0][0];
}

/** 稻草人是否生效 */
export function isScarecrowActive(state: FarmStateV2, now: number): boolean {
  return state.scarecrowUntil != null && state.scarecrowUntil > now;
}

export function isBellActive(state: FarmStateV2, now: number): boolean {
  return state.bellUntil != null && state.bellUntil > now;
}

/** 自家宠物是否守护中 */
export function isPetGuarding(state: FarmStateV2, now: number): boolean {
  const pet = state.pet;
  return !!pet && pet.currentTask === 'guard'
    && pet.taskEndAt != null && pet.taskEndAt > now;
}

/** 自家宠物是否在赶乌鸦 */
export function isPetChasing(state: FarmStateV2, now: number): boolean {
  const pet = state.pet;
  return !!pet && pet.currentTask === 'chase_crow'
    && pet.taskEndAt != null && pet.taskEndAt > now;
}

/** 计算预估品质提示（用于 UI） */
export function estimateQualityHint(crop: CropInstance, now: number): Quality | null {
  if (now < crop.matureAt) return null;
  const perfect = isPerfectCare(crop, now);
  const rates = rollQualityRates(crop.fertilizer, crop.waterMissCount, perfect);
  if (rates[2] >= 0.3) return 'gold';
  if (rates[1] >= 0.3) return 'silver';
  return 'normal';
}

/** 推导土地状态（仅展示用，不修改原 LandPlot） */
export function computeLandStatus(
  plot: LandPlot,
  now: number,
): { status: import('@/lib/types/farm-v2').LandStatus; stage: CropStageV2 | null; progress: number; remaining: number; nextWater: number } {
  if (plot.status === 'locked') {
    return { status: 'locked', stage: null, progress: 0, remaining: 0, nextWater: 0 };
  }
  if (plot.status === 'withered') {
    return { status: 'withered', stage: null, progress: 0, remaining: 0, nextWater: 0 };
  }
  if (plot.status === 'eaten') {
    return { status: 'eaten', stage: null, progress: 0, remaining: 0, nextWater: 0 };
  }
  if (!plot.crop) {
    return { status: 'empty', stage: null, progress: 0, remaining: 0, nextWater: 0 };
  }
  const crop = plot.crop;

  // 缺水 3+ 应当已经在 tick 中变为 withered；这里防御性检查
  if (crop.waterMissCount >= 3) {
    return { status: 'withered', stage: null, progress: 0, remaining: 0, nextWater: 0 };
  }
  const progress = computeGrowthProgress(crop, now);
  const stage = computeCropStage(progress);
  const remaining = Math.max(0, crop.matureAt - now);
  const nextWater = stage === 'mature' ? 0 : Math.max(0, crop.nextWaterDueAt - now);

  if (stage === 'mature') {
    return { status: 'mature', stage, progress, remaining: 0, nextWater: 0 };
  }
  if (plot.status === 'thirsty' && crop.waterMissCount > 0) {
    return { status: 'thirsty', stage, progress, remaining, nextWater };
  }
  // 当前是否正在缺水（已超过 nextWaterDueAt 但还未触发新的 miss）
  if (now > crop.nextWaterDueAt) {
    return { status: 'thirsty', stage, progress, remaining, nextWater: 0 };
  }
  return { status: 'growing', stage, progress, remaining, nextWater };
}

/** 构建 ComputedLand 数组 */
export function buildComputedLands(
  state: FarmStateV2,
  now: number,
): ComputedLand[] {
  return state.lands.map((plot) => {
    const cs = computeLandStatus(plot, now);
    const overripe = plot.crop ? computeOverripeFactor(plot.crop, now) : 1;
    const hint = plot.crop ? estimateQualityHint(plot.crop, now) : null;
    return {
      ...plot,
      status: cs.status,
      stage: cs.stage,
      growthProgress: cs.progress,
      remainingMs: cs.remaining,
      nextWaterRemainingMs: cs.nextWater,
      overripeFactor: overripe,
      expectedQualityHint: hint,
      scarecrowActive: isScarecrowActive(state, now),
      bellActive: isBellActive(state, now),
      netActive: !!(plot.crop?.birdNetUntil && plot.crop.birdNetUntil > now),
    };
  });
}

/** 当前可种作物：必须解锁（landIndex >= unlockLandCount）且季节匹配 */
export function getPlantableCrops(state: FarmStateV2, season: Season): CropIdV2[] {
  const unlockedLandCount = state.lands.filter((l) => l.status !== 'locked').length;
  const ids: CropIdV2[] = [];
  for (const cid of Object.keys(CROPS_V2) as CropIdV2[]) {
    const def = CROPS_V2[cid];
    if (def.unlockLandCount > unlockedLandCount) continue;
    if (!def.seasons.includes(season)) continue;
    ids.push(cid);
  }
  return ids;
}

/** 拼装防护状态 */
export function buildProtections(state: FarmStateV2, now: number): ProtectionBuffs {
  return {
    scarecrowActive: isScarecrowActive(state, now),
    bellActive: isBellActive(state, now),
    petGuarding: isPetGuarding(state, now),
    petChasing: isPetChasing(state, now),
  };
}
