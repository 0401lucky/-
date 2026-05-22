import { describe, expect, it } from 'vitest';
import type { FarmStateV2, PetState } from '@/lib/types/farm-v2';
import { createPet, drinkPet, feedPet, normalizePetName, normalizePetState } from '../pet';

describe('farm-v2 pet creation', () => {
  it('支持新增宠物并保存用户命名', () => {
    const rabbit = createPet('rabbit', 1000, '  棉花糖  ');
    const redPanda = createPet('red_panda', 1000, '栗子');

    expect(rabbit.type).toBe('rabbit');
    expect(rabbit.name).toBe('棉花糖');
    expect(redPanda.type).toBe('red_panda');
    expect(redPanda.name).toBe('栗子');
    expect(rabbit.stage).toBe('child');
    expect(rabbit.mood).toBe(55);
    expect(rabbit.thirst).toBe(80);
    expect(rabbit.health).toBe(85);
  });

  it('空名字会回退到默认物种名，过长名字会被截断', () => {
    expect(normalizePetName('cat', '')).toBe('小白猫');
    expect(normalizePetName('dog', '一个特别特别特别长的名字')).toHaveLength(12);
  });

  it('旧存档的青年期和亲密度会迁移到新规则', () => {
    const legacy = {
      ...createPet('cat', 1000, '雪球'),
      stage: 'youth',
      growth: 90,
      intimacy: 72,
      mood: undefined,
      thirst: undefined,
      health: undefined,
      waterToday: undefined,
    } as unknown as PetState;

    const pet = normalizePetState(legacy);

    expect(pet.stage).toBe('child');
    expect(pet.mood).toBe(72);
    expect(pet.thirst).toBe(80);
    expect(pet.health).toBe(85);
    expect(pet.waterToday).toBe(0);
    expect('intimacy' in pet).toBe(false);
  });

  it('喂水会提高口渴值', () => {
    const state = createFarmState();
    state.pet!.thirst = 20;

    expect(drinkPet(state).ok).toBe(true);
    expect(state.pet!.thirst).toBe(55);
    expect(state.pet!.mood).toBe(57);
  });

  it('宠物只会从幼年成长为成年', () => {
    const state = createFarmState();
    state.pet!.growth = 150;

    const result = feedPet(state, 'premium');

    expect(result.ok).toBe(true);
    expect(state.pet!.stage).toBe('adult');
  });
});

function createFarmState(): FarmStateV2 {
  return {
    userId: 1,
    points: 100,
    lands: [],
    scarecrowUntil: null,
    bellUntil: null,
    pet: createPet('dog', 1000, '豆豆'),
    stolenTodayCount: 0,
    stolenByMap: {},
    myStealMap: {},
    inventory: {},
    seedInventory: {},
    events: [],
    lastDailyResetAt: 1000,
    lastSeasonProcessedAt: 1000,
    lastTickAt: 1000,
    bonuses: {
      firstWater: false,
      firstHarvest: false,
      firstAdopt: true,
    },
    createdAt: 1000,
    updatedAt: 1000,
  };
}
