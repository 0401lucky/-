import { describe, expect, it } from 'vitest';
import type { FarmStateV2, LandPlot, PetState, PetType } from '@/lib/types/farm-v2';
import {
  createPet,
  dispatchPetTask,
  drinkPet,
  feedPet,
  normalizePetName,
  normalizePetState,
  processPetWaterTask,
} from '../pet';
import { PET_TASKS, PET_WATER_REST_MINUTES } from '../config';

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

  it('自动浇水工作期内会立即浇所有缺水土地', () => {
    const now = 1_700_000_000_000;
    const state = createFarmState();
    state.pet = createWorkingPet('dog', now - 30 * 60 * 1000);
    state.lands = [
      createLand(1, now - 20 * 60 * 1000, now + 60 * 60 * 1000, 'thirsty'),
      createLand(2, now - 10 * 60 * 1000, now + 60 * 60 * 1000, 'thirsty'),
      createLand(3, now + 20 * 60 * 1000, now + 60 * 60 * 1000, 'growing'),
    ];

    processPetWaterTask(state, now - 5 * 60 * 1000, now);

    expect(state.lands[0].status).toBe('growing');
    expect(state.lands[1].status).toBe('growing');
    expect(state.lands[0].crop?.lastWaterAt).toBe(now - 5 * 60 * 1000);
    expect(state.lands[1].crop?.lastWaterAt).toBe(now - 5 * 60 * 1000);
    expect(state.lands[2].crop?.lastWaterAt).toBe(now - 10 * 60 * 1000);
  });

  it('自动浇水工作期内会浇所有即将缺水土地', () => {
    const now = 1_700_000_000_000;
    const lastTickAt = now - 60 * 1000;
    const state = createFarmState();
    state.pet = createWorkingPet('dog', now - 30 * 60 * 1000);
    state.lands = [
      createLand(1, now + 5 * 60 * 1000, now + 60 * 60 * 1000, 'growing'),
      createLand(2, now + 8 * 60 * 1000, now + 60 * 60 * 1000, 'growing'),
      createLand(3, now + 20 * 60 * 1000, now + 60 * 60 * 1000, 'growing'),
    ];

    processPetWaterTask(state, lastTickAt, now);

    expect(state.lands[0].crop?.lastWaterAt).toBe(lastTickAt);
    expect(state.lands[1].crop?.lastWaterAt).toBe(lastTickAt);
    expect(state.lands[2].crop?.lastWaterAt).toBe(now - 10 * 60 * 1000);
  });

  it('自动浇水结束后的休息时间按宠物类型计算', () => {
    const now = 1_700_000_000_000;
    const catState = createFarmState();
    const dogState = createFarmState();
    catState.pet = createReadyPet('cat');
    dogState.pet = createReadyPet('dog');

    expect(dispatchPetTask(catState, 'water', now).ok).toBe(true);
    expect(dispatchPetTask(dogState, 'water', now).ok).toBe(true);

    const waterDurationMs = PET_TASKS.water.durationMinutes * 60 * 1000;
    expect(catState.pet?.cooldownEndAt).toBe(now + waterDurationMs + PET_WATER_REST_MINUTES.cat * 60 * 1000);
    expect(dogState.pet?.cooldownEndAt).toBe(now + waterDurationMs + PET_WATER_REST_MINUTES.dog * 60 * 1000);
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

function createReadyPet(type: PetType): PetState {
  const pet = createPet(type, 1000);
  pet.stage = 'adult';
  pet.growth = 180;
  pet.hunger = 80;
  pet.cleanliness = 80;
  pet.thirst = 80;
  pet.health = 85;
  pet.mood = 70;
  pet.learnedSkills = ['water'];
  return pet;
}

function createWorkingPet(type: PetType, taskStartAt: number): PetState {
  const pet = createReadyPet(type);
  pet.currentTask = 'water';
  pet.taskStartAt = taskStartAt;
  pet.taskEndAt = taskStartAt + PET_TASKS.water.durationMinutes * 60 * 1000;
  pet.cooldownEndAt = pet.taskEndAt + PET_WATER_REST_MINUTES[type] * 60 * 1000;
  return pet;
}

function createLand(
  index: number,
  nextWaterDueAt: number,
  matureAt: number,
  status: LandPlot['status'],
): LandPlot {
  return {
    index,
    status,
    crop: {
      cropId: 'wheat',
      plantedAt: nextWaterDueAt - 30 * 60 * 1000,
      matureAt,
      lastWaterAt: nextWaterDueAt - 30 * 60 * 1000,
      nextWaterDueAt,
      waterMissCount: status === 'thirsty' ? 1 : 0,
      fertilizer: null,
      plantedSeason: 'spring',
      weatherAtPlant: 'sunny',
      birdNetUntil: null,
      stolenAmount: 0,
      stolenCount: 0,
      speedUsed: 0,
      speedReducedMinutes: 0,
    },
  };
}
