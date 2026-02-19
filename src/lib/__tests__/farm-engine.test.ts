import { describe, expect, it } from 'vitest';
import { PEST_CHECK_WINDOW } from '../farm-config';
import {
  computeGrowthProgress,
  computeMissedWaterCycles,
  computePlotState,
  getPestAppearTime,
  needsWater,
  shouldPestAppear,
} from '../farm-engine';

describe('farm-engine', () => {
  it('does not let cleared pests immediately reappear from historical windows', () => {
    const plantedAt = Date.UTC(2026, 0, 1, 0, 0, 0);
    const now = plantedAt + 48 * 60 * 60 * 1000;

    let userId = 1;
    let plotIndex = 0;
    let pestTime: number | null = null;

    // 找到一个确定会出虫的组合，确保断言稳定
    for (let u = 1; u <= 120 && pestTime === null; u++) {
      for (let p = 0; p < 12 && pestTime === null; p++) {
        if (shouldPestAppear(u, p, plantedAt, now, 'sunny')) {
          userId = u;
          plotIndex = p;
          pestTime = getPestAppearTime(u, p, plantedAt, now, 'sunny');
        }
      }
    }

    expect(pestTime).not.toBeNull();

    const clearAt = (pestTime as number) + 1;
    const immediateCheck = clearAt + 1;
    const hasPestImmediately = shouldPestAppear(
      userId,
      plotIndex,
      plantedAt,
      immediateCheck,
      'sunny',
      clearAt,
    );

    expect(hasPestImmediately).toBe(false);
  });

  it('keeps growth progress stable regardless of current day weather parameter', () => {
    const plantedAt = Date.UTC(2026, 0, 1, 0, 0, 0);
    const now = Date.UTC(2026, 0, 3, 12, 0, 0);

    const sunnyProgress = computeGrowthProgress(plantedAt, now, 'corn');
    const droughtProgress = computeGrowthProgress(plantedAt, now, 'corn');

    expect(sunnyProgress).toBeCloseTo(droughtProgress, 10);
  });

  it('does not reset missed watering history just because current weather changes', () => {
    const plantedAt = Date.UTC(2026, 0, 1, 0, 0, 0);
    const now = plantedAt + 8 * 60 * 60 * 1000;

    const missedBySunny = computeMissedWaterCycles(null, plantedAt, now, 'wheat');
    const missedByRainy = computeMissedWaterCycles(null, plantedAt, now, 'wheat');

    expect(missedBySunny).toBe(missedByRainy);
    expect(missedBySunny).toBeGreaterThan(0);
  });

  it('still disables manual watering when current weather is auto-water', () => {
    const plantedAt = Date.UTC(2026, 0, 1, 0, 0, 0);
    const now = plantedAt + 2 * 60 * 60 * 1000;

    expect(needsWater(null, plantedAt, now, 'wheat', 'rainy')).toBe(false);
    expect(needsWater(null, plantedAt, now, 'wheat', 'sunny')).toBe(true);
  });

  it('computePlotState keeps pest removed at least until next pest window', () => {
    const plantedAt = Date.UTC(2026, 0, 1, 0, 0, 0);
    const now = plantedAt + 24 * 60 * 60 * 1000;
    let userId = 1;
    let plotIndex = 0;
    let pestTime: number | null = null;

    for (let u = 1; u <= 120 && pestTime === null; u++) {
      for (let p = 0; p < 12 && pestTime === null; p++) {
        const candidate = getPestAppearTime(u, p, plantedAt, now, 'sunny');
        if (candidate !== null) {
          userId = u;
          plotIndex = p;
          pestTime = candidate;
        }
      }
    }

    expect(pestTime).not.toBeNull();
    const clearAt = (pestTime as number) + 1;
    const state = computePlotState(
      {
        index: plotIndex,
        cropId: 'wheat',
        plantedAt,
        lastWateredAt: plantedAt,
        waterCount: 1,
        hasPest: false,
        pestAppearedAt: null,
        pestClearedAt: clearAt,
        stage: 'seed',
        yieldMultiplier: 1,
      },
      clearAt + Math.floor(PEST_CHECK_WINDOW / 2),
      'sunny',
      userId,
    );

    expect(state.hasPest).toBe(false);
  });
});
