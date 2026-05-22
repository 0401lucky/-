// 农场 v1.2 引擎单元测试

import { describe, it, expect } from 'vitest';
import {
  computeActualGrowthMs, computeActualWaterIntervalMs, computeCropStage,
  computeGrowthProgress, computeFinalYield, computeOverripeFactor,
  rollQualityRates, isPerfectCare, getCurrentSeason, getNextSeasonChangeMs,
  buildComputedLands,
} from '../engine';
import { advanceWaterMisses } from '../season';
import type { CropInstance, FarmStateV2 } from '@/lib/types/farm-v2';

describe('farm-v2 engine', () => {
  it('成长时间公式：小麦 春季 中级肥料', () => {
    // 30 * 0.95 * 0.80 = 22.8 分钟
    const ms = computeActualGrowthMs('wheat', 'spring', 'medium');
    expect(ms).toBeCloseTo(22.8 * 60 * 1000, -2);
  });

  it('浇水间隔：胡萝卜 夏季 炎热', () => {
    // 30 * 0.85 * 0.80 = 20.4 分钟
    const ms = computeActualWaterIntervalMs('carrot', 'summer', 'hot');
    expect(ms).toBeCloseTo(20.4 * 60 * 1000, -2);
  });

  it('阶段切换边界', () => {
    expect(computeCropStage(0)).toBe('seed');
    expect(computeCropStage(0.19)).toBe('seed');
    expect(computeCropStage(0.2)).toBe('sprout');
    expect(computeCropStage(0.499)).toBe('sprout');
    expect(computeCropStage(0.5)).toBe('growing');
    expect(computeCropStage(0.99)).toBe('growing');
    expect(computeCropStage(1)).toBe('mature');
  });

  it('过熟系数阶梯', () => {
    const crop: CropInstance = {
      cropId: 'wheat', plantedAt: 0, matureAt: 0,
      lastWaterAt: 0, nextWaterDueAt: 0, waterMissCount: 0,
      fertilizer: null, plantedSeason: 'spring', weatherAtPlant: 'sunny',
      birdNetUntil: null, stolenAmount: 0, stolenCount: 0,
      speedUsed: 0, speedReducedMinutes: 0,
    };
    expect(computeOverripeFactor(crop, 0)).toBe(1);
    expect(computeOverripeFactor(crop, 11 * 3600 * 1000)).toBe(1);
    expect(computeOverripeFactor(crop, 13 * 3600 * 1000)).toBe(0.8);
    expect(computeOverripeFactor(crop, 30 * 3600 * 1000)).toBe(0.5);
    expect(computeOverripeFactor(crop, 50 * 3600 * 1000)).toBe(0);
  });

  it('品质概率归一化总和为 1', () => {
    const rates = rollQualityRates('medium', 1, true);
    const sum = rates[0] + rates[1] + rates[2];
    expect(sum).toBeCloseTo(1, 6);
  });

  it('缺水 3 次必返回 100% 普通', () => {
    expect(rollQualityRates('premium', 3, false)).toEqual([1, 0, 0]);
  });

  it('完美照顾判定', () => {
    const crop: CropInstance = {
      cropId: 'wheat', plantedAt: 0, matureAt: 1000,
      lastWaterAt: 0, nextWaterDueAt: 0, waterMissCount: 0,
      fertilizer: null, plantedSeason: 'spring', weatherAtPlant: 'sunny',
      birdNetUntil: null, stolenAmount: 0, stolenCount: 0,
      speedUsed: 0, speedReducedMinutes: 0,
    };
    expect(isPerfectCare(crop, 1500)).toBe(true);
    crop.waterMissCount = 1;
    expect(isPerfectCare(crop, 1500)).toBe(false);
  });

  it('收获公式：金星草莓 秋季', () => {
    // 75 × 1.8 × 1.0 × 1.10（秋）× 1.0 = 148.5 → 148
    const y = computeFinalYield('strawberry', 'gold', 0, 'autumn', 1, 0);
    expect(y).toBe(148);
  });

  it('收获公式：缺水 1 次普通小麦', () => {
    // 12 × 1.0 × 0.8 × 1.0（春）= 9.6 → 9
    const y = computeFinalYield('wheat', 'normal', 1, 'spring', 1, 0);
    expect(y).toBe(9);
  });

  it('被偷扣除 ≥ 收益时不为负', () => {
    const y = computeFinalYield('wheat', 'normal', 0, 'spring', 1, 999);
    expect(y).toBe(0);
  });

  it('季节循环', () => {
    const seasons = ['spring', 'summer', 'autumn', 'winter'];
    expect(seasons).toContain(getCurrentSeason(Date.now()));
  });

  it('距下次换季为正且不超过 7 天', () => {
    const ms = getNextSeasonChangeMs(Date.now());
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it('成长进度计算', () => {
    const crop: CropInstance = {
      cropId: 'wheat', plantedAt: 0, matureAt: 100,
      lastWaterAt: 0, nextWaterDueAt: 0, waterMissCount: 0,
      fertilizer: null, plantedSeason: 'spring', weatherAtPlant: 'sunny',
      birdNetUntil: null, stolenAmount: 0, stolenCount: 0,
      speedUsed: 0, speedReducedMinutes: 0,
    };
    expect(computeGrowthProgress(crop, 0)).toBe(0);
    expect(computeGrowthProgress(crop, 50)).toBe(0.5);
    expect(computeGrowthProgress(crop, 100)).toBe(1);
    expect(computeGrowthProgress(crop, 200)).toBe(1);
  });

  it('缺水后保持可浇水状态，浇水后恢复生长', () => {
    const now = 40 * 60 * 1000;
    const state: FarmStateV2 = {
      userId: 1,
      points: 100,
      lands: [{
        index: 1,
        status: 'growing',
        crop: {
          cropId: 'wheat',
          plantedAt: 0,
          matureAt: 120 * 60 * 1000,
          lastWaterAt: 0,
          nextWaterDueAt: 30 * 60 * 1000,
          waterMissCount: 0,
          fertilizer: null,
          plantedSeason: 'spring',
          weatherAtPlant: 'sunny',
          birdNetUntil: null,
          stolenAmount: 0,
          stolenCount: 0,
          speedUsed: 0,
          speedReducedMinutes: 0,
        },
      }],
      scarecrowUntil: null,
      bellUntil: null,
      pet: null,
      stolenTodayCount: 0,
      stolenByMap: {},
      myStealMap: {},
      inventory: {},
      purchasedSkillBooks: {},
      seedInventory: {},
      events: [],
      lastDailyResetAt: 0,
      lastSeasonProcessedAt: 0,
      lastTickAt: 0,
      bonuses: { firstWater: false, firstHarvest: false, firstAdopt: false },
      createdAt: 0,
      updatedAt: 0,
    };

    advanceWaterMisses(state, now, 'spring', 'sunny');

    expect(state.lands[0].status).toBe('thirsty');
    expect(state.lands[0].crop?.waterMissCount).toBe(1);
    const thirstyLand = buildComputedLands(state, now)[0];
    expect(thirstyLand.status).toBe('thirsty');
    expect(thirstyLand.nextWaterRemainingMs).toBeGreaterThan(0);

    const crop = state.lands[0].crop!;
    crop.lastWaterAt = now;
    crop.nextWaterDueAt = now + computeActualWaterIntervalMs('wheat', 'spring', 'sunny');
    state.lands[0].status = 'growing';

    const wateredLand = buildComputedLands(state, now)[0];
    expect(wateredLand.status).toBe('growing');
    expect(wateredLand.crop?.waterMissCount).toBe(1);
  });
});
