import { describe, expect, it } from 'vitest';
import type { FarmStateV2 } from '@/lib/types/farm-v2';
import { computeActualGrowthMs } from '../engine';
import { applyItemUse } from '../shop';

function createFarmState(): FarmStateV2 {
  const plantedAt = 0;
  const matureAt = computeActualGrowthMs('wheat', 'spring', null);

  return {
    userId: 1,
    points: 100,
    lands: [
      {
        index: 1,
        status: 'growing',
        crop: {
          cropId: 'wheat',
          plantedAt,
          matureAt,
          lastWaterAt: plantedAt,
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
      },
    ],
    scarecrowUntil: null,
    bellUntil: null,
    pet: null,
    stolenTodayCount: 0,
    stolenByMap: {},
    myStealMap: {},
    inventory: {
      fert_medium: { count: 1, updatedAt: 0 },
    },
    seedInventory: {},
    events: [],
    lastDailyResetAt: 0,
    lastSeasonProcessedAt: 0,
    lastTickAt: 0,
    bonuses: {
      firstWater: false,
      firstHarvest: false,
      firstAdopt: false,
    },
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('farm-v2 shop item use', () => {
  it('肥料作为背包道具作用到指定作物', () => {
    const state = createFarmState();
    const result = applyItemUse(state, 'fert_medium', 10_000, 0);

    expect(result.ok).toBe(true);
    expect(state.inventory.fert_medium?.count).toBe(0);
    expect(state.lands[0].crop?.fertilizer).toBe('medium');
    expect(state.lands[0].crop?.matureAt).toBe(computeActualGrowthMs('wheat', 'spring', 'medium'));
    expect(state.events[0]?.text).toContain('使用了中级肥料');
  });

  it('同一轮作物不能重复施肥', () => {
    const state = createFarmState();
    applyItemUse(state, 'fert_medium', 10_000, 0);
    state.inventory.fert_normal = { count: 1, updatedAt: 0 };

    const result = applyItemUse(state, 'fert_normal', 10_000, 0);

    expect(result.ok).toBe(false);
    expect(result.msg).toBe('该作物已使用过肥料');
    expect(state.inventory.fert_normal?.count).toBe(1);
  });

  it('最后的晚餐会放生当前宠物', () => {
    const state = createFarmState();
    state.pet = {
      type: 'cat',
      name: '小雪球',
      stage: 'adult',
      growth: 240,
      hunger: 80,
      cleanliness: 90,
      mood: 75,
      thirst: 20,
      health: 90,
      currentTask: null,
      taskStartAt: null,
      taskEndAt: null,
      cooldownEndAt: null,
      stealTarget: null,
      feedToday: { normal: 0, premium: 0 },
      washToday: 0,
      waterToday: 0,
      playToday: 0,
      toyToday: 0,
      dailyResetAt: 0,
    };
    state.inventory.last_supper = { count: 1, updatedAt: 0 };

    const result = applyItemUse(state, 'last_supper', 10_000);

    expect(result.ok).toBe(true);
    expect(state.inventory.last_supper?.count).toBe(0);
    expect(state.pet).toBeNull();
    expect(state.events[0]?.text).toContain('最后的晚餐');
    expect(state.events[0]?.text).toContain('小雪球');
    expect(state.events[0]?.text).toContain('离开了庄园');
  });

  it('没有宠物时使用最后的晚餐不会消耗库存', () => {
    const state = createFarmState();
    state.inventory.last_supper = { count: 1, updatedAt: 0 };

    const result = applyItemUse(state, 'last_supper', 10_000);

    expect(result.ok).toBe(false);
    expect(result.msg).toBe('当前没有宠物');
    expect(state.inventory.last_supper?.count).toBe(1);
  });

  it('成年宠物可以学习商店购买的技能书', () => {
    const state = createFarmState();
    state.pet = {
      type: 'dog',
      name: '豆豆',
      stage: 'adult',
      growth: 240,
      hunger: 80,
      cleanliness: 90,
      mood: 75,
      thirst: 80,
      hydrationVersion: 2,
      health: 90,
      learnedSkills: [],
      currentTask: null,
      taskStartAt: null,
      taskEndAt: null,
      cooldownEndAt: null,
      stealTarget: null,
      feedToday: { normal: 0, premium: 0 },
      washToday: 0,
      waterToday: 0,
      playToday: 0,
      toyToday: 0,
      dailyResetAt: 0,
    };
    state.inventory.pet_skill_harvest = { count: 1, updatedAt: 0 };

    const result = applyItemUse(state, 'pet_skill_harvest', 10_000);

    expect(result.ok).toBe(true);
    expect(state.inventory.pet_skill_harvest?.count).toBe(0);
    expect(state.pet.learnedSkills).toContain('harvest');
    expect(state.events[0]?.text).toContain('学会了收菜技能');
  });

  it('幼年宠物不能学习技能书且不消耗库存', () => {
    const state = createFarmState();
    state.pet = {
      type: 'rabbit',
      name: '棉花糖',
      stage: 'child',
      growth: 20,
      hunger: 80,
      cleanliness: 80,
      mood: 60,
      thirst: 80,
      hydrationVersion: 2,
      health: 90,
      learnedSkills: [],
      currentTask: null,
      taskStartAt: null,
      taskEndAt: null,
      cooldownEndAt: null,
      stealTarget: null,
      feedToday: { normal: 0, premium: 0 },
      washToday: 0,
      waterToday: 0,
      playToday: 0,
      toyToday: 0,
      dailyResetAt: 0,
    };
    state.inventory.pet_skill_plant = { count: 1, updatedAt: 0 };

    const result = applyItemUse(state, 'pet_skill_plant', 10_000);

    expect(result.ok).toBe(false);
    expect(result.msg).toBe('宠物成年后才能学习技能书');
    expect(state.inventory.pet_skill_plant?.count).toBe(1);
    expect(state.pet.learnedSkills).not.toContain('plant');
  });

  it('同一只宠物不能重复学习相同技能书且不消耗库存', () => {
    const state = createFarmState();
    state.pet = {
      type: 'dog',
      name: '豆豆',
      stage: 'adult',
      growth: 240,
      hunger: 80,
      cleanliness: 90,
      mood: 75,
      thirst: 80,
      hydrationVersion: 2,
      health: 90,
      learnedSkills: ['harvest'],
      currentTask: null,
      taskStartAt: null,
      taskEndAt: null,
      cooldownEndAt: null,
      stealTarget: null,
      feedToday: { normal: 0, premium: 0 },
      washToday: 0,
      waterToday: 0,
      playToday: 0,
      toyToday: 0,
      dailyResetAt: 0,
    };
    state.inventory.pet_skill_harvest = { count: 2, updatedAt: 0 };

    const result = applyItemUse(state, 'pet_skill_harvest', 10_000);

    expect(result.ok).toBe(false);
    expect(result.msg).toBe('宠物已经学会收菜');
    expect(state.inventory.pet_skill_harvest?.count).toBe(2);
    expect(state.pet.learnedSkills).toEqual(['harvest']);
  });
});
