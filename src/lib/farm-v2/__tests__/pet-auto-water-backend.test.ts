import { describe, expect, it, vi } from 'vitest';
import type { FarmStateV2, LandPlot, PetState, PetType } from '@/lib/types/farm-v2';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    scan: vi.fn(),
  },
}));

vi.mock('@/lib/points', () => ({
  addPoints: vi.fn(async (_userId: number, amount: number) => ({ success: true, balance: amount })),
  deductPoints: vi.fn(async (_userId: number, amount: number) => ({ success: true, balance: 1000 - amount })),
  getUserPoints: vi.fn(async () => 1000),
}));

import { PET_TASKS, PET_WATER_REST_MINUTES } from '../config';
import { createPet } from '../pet';
import { tickFarm } from '../index';

function chinaTimeUtc(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
): number {
  return Date.UTC(year, monthIndex, day, hour - 8, minute, 0);
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

function createLand(index: number, nextWaterDueAt: number, now: number): LandPlot {
  return {
    index,
    status: 'growing',
    crop: {
      cropId: 'wheat',
      plantedAt: nextWaterDueAt - 30 * 60 * 1000,
      matureAt: now + 2 * 60 * 60 * 1000,
      lastWaterAt: nextWaterDueAt - 30 * 60 * 1000,
      nextWaterDueAt,
      waterMissCount: 0,
      fertilizer: null,
      plantedSeason: 'spring',
      weatherAtPlant: 'sunny',
      birdNetUntil: now + 2 * 60 * 60 * 1000,
      stolenAmount: 0,
      stolenCount: 0,
      speedUsed: 0,
      speedReducedMinutes: 0,
    },
  };
}

function createFarmState(now: number): FarmStateV2 {
  return {
    userId: 7,
    points: 100,
    lands: Array.from({ length: 8 }, (_, index) => ({
      index: index + 1,
      status: index < 4 ? 'empty' : 'locked',
      crop: null,
    })),
    scarecrowUntil: null,
    bellUntil: null,
    pet: createWorkingPet('dog', now - 30 * 60 * 1000),
    stolenTodayCount: 0,
    stolenByMap: {},
    myStealMap: {},
    inventory: {},
    purchasedSkillBooks: {},
    seedInventory: {},
    events: [],
    lastDailyResetAt: now,
    lastSeasonProcessedAt: now,
    lastTickAt: now - 60 * 1000,
    lastFridayEventDate: '',
    bonuses: {
      firstWater: false,
      firstHarvest: false,
      firstAdopt: false,
    },
    createdAt: now,
    updatedAt: now,
  };
}

describe('farm-v2 pet auto water backend tick', () => {
  it('后端 tick 会按中国时间结算自动浇水，并覆盖所有即将缺水土地', () => {
    const now = chinaTimeUtc(2026, 5, 3, 9, 7);
    const state = createFarmState(now);
    const previousTick = state.lastTickAt;
    state.lands[0] = createLand(1, now + 5 * 60 * 1000, now);
    state.lands[1] = createLand(2, now + 8 * 60 * 1000, now);
    state.lands[2] = createLand(3, now + 20 * 60 * 1000, now);

    tickFarm(state, now);

    expect(state.lands[0].crop?.lastWaterAt).toBe(previousTick);
    expect(state.lands[1].crop?.lastWaterAt).toBe(previousTick);
    expect(state.lands[2].crop?.lastWaterAt).toBe(now - 10 * 60 * 1000);
    expect(state.lands[0].crop?.waterMissCount).toBe(0);
    expect(state.lands[1].crop?.waterMissCount).toBe(0);
    expect(state.lastTickAt).toBe(now);
  });
});
