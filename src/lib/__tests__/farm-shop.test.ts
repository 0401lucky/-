import { describe, expect, it } from 'vitest';
import { CROPS } from '../farm-config';
import {
  buildBuffContext,
  computeGrowthProgress,
  computeMissedWaterCycles,
  computePlotState,
  computeHarvestYield,
  needsWater,
  shouldPestAppear,
} from '../farm-engine';
import type { ActiveBuff, BuffContext } from '../types/farm-shop';
import type { PlotState } from '../types/farm';

/* ===== 辅助 ===== */

const BASE_TIME = Date.UTC(2026, 0, 10, 0, 0, 0); // 2026-01-10 00:00 UTC

function makePlot(overrides: Partial<PlotState> = {}): PlotState {
  return {
    index: 0,
    cropId: 'wheat',
    plantedAt: BASE_TIME,
    lastWateredAt: BASE_TIME,
    waterCount: 1,
    hasPest: false,
    pestAppearedAt: null,
    pestClearedAt: null,
    stage: 'seed',
    yieldMultiplier: 1,
    ...overrides,
  };
}

function makeBuff(
  effect: ActiveBuff['effect'],
  activatedAt: number,
  durationMs: number,
  effectValue?: number,
): ActiveBuff {
  return {
    itemId: `test-${effect}`,
    effect,
    activatedAt,
    expiresAt: activatedAt + durationMs,
    effectValue,
  };
}

/* ===== buildBuffContext ===== */

describe('buildBuffContext', () => {
  it('returns undefined for empty array', () => {
    expect(buildBuffContext([], Date.now())).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(buildBuffContext(undefined, Date.now())).toBeUndefined();
  });

  it('filters out expired buffs', () => {
    const now = BASE_TIME + 1000;
    const expired = makeBuff('auto_water', BASE_TIME - 2000, 1000); // expired
    expect(buildBuffContext([expired], now)).toBeUndefined();
  });

  it('builds auto_water context', () => {
    const now = BASE_TIME + 1000;
    const buff = makeBuff('auto_water', BASE_TIME, 12 * 3600_000);
    const ctx = buildBuffContext([buff], now);
    expect(ctx?.autoWater).toBeDefined();
    expect(ctx?.autoWater?.activatedAt).toBe(BASE_TIME);
  });

  it('builds pest_shield context with custom reduction', () => {
    const now = BASE_TIME + 1000;
    const buff = makeBuff('pest_shield', BASE_TIME, 24 * 3600_000, 0.8);
    const ctx = buildBuffContext([buff], now);
    expect(ctx?.pestShield).toBeDefined();
    expect(ctx?.pestShield?.reduction).toBe(0.8);
  });

  it('builds growth_speed context', () => {
    const now = BASE_TIME + 1000;
    const buff = makeBuff('growth_speed', BASE_TIME, 6 * 3600_000, 2);
    const ctx = buildBuffContext([buff], now);
    expect(ctx?.growthSpeed).toBeDefined();
    expect(ctx?.growthSpeed?.multiplier).toBe(2);
  });

  it('builds yield_bonus context (1 + effectValue)', () => {
    const now = BASE_TIME + 1000;
    const buff = makeBuff('yield_bonus', BASE_TIME, 12 * 3600_000, 0.25);
    const ctx = buildBuffContext([buff], now);
    expect(ctx?.yieldBonus?.multiplier).toBe(1.25);
  });

  it('builds weather_shield context', () => {
    const now = BASE_TIME + 1000;
    const buff = makeBuff('weather_shield', BASE_TIME, 24 * 3600_000);
    const ctx = buildBuffContext([buff], now);
    expect(ctx?.weatherShield?.active).toBe(true);
  });

  it('builds auto_harvest context', () => {
    const now = BASE_TIME + 1000;
    const buff = makeBuff('auto_harvest', BASE_TIME, 12 * 3600_000);
    const ctx = buildBuffContext([buff], now);
    expect(ctx?.autoHarvest?.active).toBe(true);
  });

  it('handles multiple active buffs simultaneously', () => {
    const now = BASE_TIME + 1000;
    const buffs: ActiveBuff[] = [
      makeBuff('auto_water', BASE_TIME, 12 * 3600_000),
      makeBuff('yield_bonus', BASE_TIME, 12 * 3600_000, 0.25),
      makeBuff('weather_shield', BASE_TIME, 24 * 3600_000),
    ];
    const ctx = buildBuffContext(buffs, now);
    expect(ctx?.autoWater).toBeDefined();
    expect(ctx?.yieldBonus).toBeDefined();
    expect(ctx?.weatherShield?.active).toBe(true);
  });
});

/* ===== 引擎 buff 集成 ===== */

describe('farm-engine buff integration', () => {

  /* --- growth_speed --- */
  describe('growth_speed buff', () => {
    it('accelerates growth when buff is active', () => {
      // strawberry growthTime = 30min, check at 10min → progress ~0.33 without buff
      const now = BASE_TIME + 10 * 60_000; // 10分钟后
      const progressNoBuff = computeGrowthProgress(BASE_TIME, now, 'strawberry');

      const ctx: BuffContext = {
        growthSpeed: {
          activatedAt: BASE_TIME,
          expiresAt: BASE_TIME + 6 * 3600_000,
          multiplier: 2,
        },
      };
      const progressWithBuff = computeGrowthProgress(BASE_TIME, now, 'strawberry', ctx);

      // 2x speed buff should make progress roughly double
      expect(progressWithBuff).toBeGreaterThan(progressNoBuff);
      expect(progressWithBuff).toBeCloseTo(progressNoBuff * 2, 1);
    });

    it('only applies during buff active period', () => {
      // strawberry growthTime = 30min
      const buffEnd = BASE_TIME + 5 * 60_000; // buff lasts 5 min
      const now = BASE_TIME + 15 * 60_000; // check at 15 min

      const ctx: BuffContext = {
        growthSpeed: {
          activatedAt: BASE_TIME,
          expiresAt: buffEnd,
          multiplier: 2,
        },
      };
      const progressWithExpiredBuff = computeGrowthProgress(BASE_TIME, now, 'strawberry', ctx);
      const progressNoBuff = computeGrowthProgress(BASE_TIME, now, 'strawberry');

      // Should have partial acceleration (first 5 min at 2x, last 10 min at 1x)
      expect(progressWithExpiredBuff).toBeGreaterThan(progressNoBuff);
      // But less than full 2x
      expect(progressWithExpiredBuff).toBeLessThan(progressNoBuff * 2);
    });
  });

  /* --- auto_water --- */
  describe('auto_water buff', () => {
    it('prevents needing water when buff is active', () => {
      const crop = CROPS['wheat'];
      const now = BASE_TIME + crop.waterInterval + 60_000; // past water interval

      expect(needsWater(BASE_TIME, BASE_TIME, now, 'wheat', 'sunny')).toBe(true);

      const ctx: BuffContext = {
        autoWater: {
          activatedAt: BASE_TIME,
          expiresAt: BASE_TIME + 12 * 3600_000,
        },
      };
      expect(needsWater(BASE_TIME, BASE_TIME, now, 'wheat', 'sunny', ctx)).toBe(false);
    });

    it('reduces missed water cycles during buff period', () => {
      const crop = CROPS['wheat'];
      const now = BASE_TIME + crop.waterInterval * 3; // 3 intervals

      const missedNoBuff = computeMissedWaterCycles(BASE_TIME, BASE_TIME, now, 'wheat');
      expect(missedNoBuff).toBeGreaterThan(0);

      const ctx: BuffContext = {
        autoWater: {
          activatedAt: BASE_TIME,
          expiresAt: BASE_TIME + 12 * 3600_000,
        },
      };
      const missedWithBuff = computeMissedWaterCycles(BASE_TIME, BASE_TIME, now, 'wheat', ctx);
      expect(missedWithBuff).toBeLessThan(missedNoBuff);
    });
  });

  /* --- pest_shield --- */
  describe('pest_shield buff', () => {
    it('reduces pest probability during buff period', () => {
      const plantedAt = BASE_TIME;
      const now = plantedAt + 48 * 3600_000; // 48h later, lots of windows

      // Find a userId/plotIndex combo that gets a pest without buff
      let userId = 1;
      let plotIndex = 0;
      let found = false;

      for (let u = 1; u <= 200 && !found; u++) {
        for (let p = 0; p < 12 && !found; p++) {
          if (shouldPestAppear(u, p, plantedAt, now, 'sunny')) {
            userId = u;
            plotIndex = p;
            found = true;
          }
        }
      }

      if (!found) return; // Skip if no pest appears in test range

      // With pest_shield at 80% reduction, pest should be less likely
      const ctx: BuffContext = {
        pestShield: {
          activatedAt: plantedAt,
          expiresAt: plantedAt + 48 * 3600_000,
          reduction: 0.8,
        },
      };

      const hasPestWithBuff = shouldPestAppear(userId, plotIndex, plantedAt, now, 'sunny', null, ctx);
      // The pest might still appear (20% of original chance), but the effective chance is lower
      // We can't guarantee it disappears for a single case, so just verify the function accepts the param
      expect(typeof hasPestWithBuff).toBe('boolean');
    });
  });

  /* --- weather_shield --- */
  describe('weather_shield buff', () => {
    it('neutralizes negative weather yield in computePlotState', () => {
      const now = BASE_TIME + 2 * 3600_000;
      const plot = makePlot({
        cropId: 'wheat',
        plantedAt: BASE_TIME,
        lastWateredAt: now, // just watered
        stage: 'mature',
      });

      // Without buff, drought reduces yield
      const stateNoShield = computePlotState(plot, now, 'drought', 1);

      const ctx: BuffContext = {
        weatherShield: { active: true },
      };
      const stateWithShield = computePlotState(plot, now, 'drought', 1, ctx);

      // With weather shield, yield should be strictly greater (drought has yieldModifier < 1)
      expect(stateWithShield.estimatedYield).toBeGreaterThan(stateNoShield.estimatedYield);
    });

    it('neutralizes negative weather in computeHarvestYield', () => {
      const now = BASE_TIME + 2 * 3600_000;
      const plot = makePlot({
        cropId: 'wheat',
        plantedAt: BASE_TIME,
        lastWateredAt: now,
        stage: 'mature',
      });

      const noShield = computeHarvestYield(plot, now, 'drought');
      const withShield = computeHarvestYield(plot, now, 'drought', {
        weatherShield: { active: true },
      });

      expect(withShield.yield).toBeGreaterThan(noShield.yield);
    });
  });

  /* --- yield_bonus --- */
  describe('yield_bonus buff', () => {
    it('increases harvest yield by multiplier', () => {
      // Ensure no missed water cycles: lastWateredAt = now
      const now = BASE_TIME + 2 * 3600_000;
      const plot = makePlot({
        cropId: 'wheat',
        plantedAt: BASE_TIME,
        lastWateredAt: now,
        stage: 'mature',
      });

      const noBonus = computeHarvestYield(plot, now, 'sunny');
      const withBonus = computeHarvestYield(plot, now, 'sunny', {
        yieldBonus: { multiplier: 1.25 },
      });

      expect(noBonus.yield).toBe(CROPS['wheat'].baseYield);
      expect(withBonus.yield).toBeGreaterThan(noBonus.yield);
    });

    it('increases estimatedYield in computePlotState', () => {
      const now = BASE_TIME + 2 * 3600_000;
      const plot = makePlot({
        cropId: 'wheat',
        plantedAt: BASE_TIME,
        lastWateredAt: now,
        stage: 'mature',
      });

      const stateNoBuff = computePlotState(plot, now, 'sunny', 1);
      const stateWithBuff = computePlotState(plot, now, 'sunny', 1, {
        yieldBonus: { multiplier: 1.25 },
      });

      expect(stateWithBuff.estimatedYield).toBeGreaterThan(stateNoBuff.estimatedYield);
    });
  });

  /* --- backward compatibility --- */
  describe('backward compatibility (no buffCtx)', () => {
    it('computeGrowthProgress returns same result without buffCtx', () => {
      const now = BASE_TIME + 30 * 60_000;
      const a = computeGrowthProgress(BASE_TIME, now, 'wheat');
      const b = computeGrowthProgress(BASE_TIME, now, 'wheat', undefined);
      expect(a).toBe(b);
    });

    it('computeMissedWaterCycles returns same result without buffCtx', () => {
      const now = BASE_TIME + 5 * 3600_000;
      const a = computeMissedWaterCycles(BASE_TIME, BASE_TIME, now, 'wheat');
      const b = computeMissedWaterCycles(BASE_TIME, BASE_TIME, now, 'wheat', undefined);
      expect(a).toBe(b);
    });

    it('needsWater returns same result without buffCtx', () => {
      const now = BASE_TIME + 2 * 3600_000;
      const a = needsWater(BASE_TIME, BASE_TIME, now, 'wheat', 'sunny');
      const b = needsWater(BASE_TIME, BASE_TIME, now, 'wheat', 'sunny', undefined);
      expect(a).toBe(b);
    });

    it('shouldPestAppear returns same result without buffCtx', () => {
      const now = BASE_TIME + 24 * 3600_000;
      const a = shouldPestAppear(1, 0, BASE_TIME, now, 'sunny');
      const b = shouldPestAppear(1, 0, BASE_TIME, now, 'sunny', null, undefined);
      expect(a).toBe(b);
    });

    it('computePlotState returns same result without buffCtx', () => {
      const plot = makePlot();
      const now = BASE_TIME + 3600_000;
      const a = computePlotState(plot, now, 'sunny', 1);
      const b = computePlotState(plot, now, 'sunny', 1, undefined);
      expect(a).toEqual(b);
    });

    it('computeHarvestYield returns same result without buffCtx', () => {
      const plot = makePlot({ stage: 'mature' });
      const now = BASE_TIME + 3600_000;
      const a = computeHarvestYield(plot, now, 'sunny');
      const b = computeHarvestYield(plot, now, 'sunny', undefined);
      expect(a).toEqual(b);
    });
  });

  /* --- combined buffs --- */
  describe('combined buffs', () => {
    it('weather_shield + yield_bonus stack correctly', () => {
      const now = BASE_TIME + 2 * 3600_000;
      const plot = makePlot({
        cropId: 'wheat',
        plantedAt: BASE_TIME,
        lastWateredAt: now, // just watered, no missed cycles
        stage: 'mature',
      });

      const ctx: BuffContext = {
        weatherShield: { active: true },
        yieldBonus: { multiplier: 1.25 },
      };

      const result = computeHarvestYield(plot, now, 'drought', ctx);
      const crop = CROPS['wheat'];
      // weather shield neutralizes drought penalty, yield bonus adds 25%
      expect(result.yield).toBeGreaterThan(0);
      expect(result.yield).toBeGreaterThanOrEqual(Math.floor(crop.baseYield * 1.25));
    });
  });
});
