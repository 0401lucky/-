import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { addPoints, deductPoints, getUserPoints } from '@/lib/points';
import type { FarmStateV2, PetState } from '@/lib/types/farm-v2';
import { buyItem, getFarmStatus } from '../index';

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

describe('farm-v2 shop purchases', () => {
  const userId = 77;
  const stateKey = `farmv2:state:${userId}`;
  const mockKvSet = vi.mocked(kv.set);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvDel = vi.mocked(kv.del);
  const mockAddPoints = vi.mocked(addPoints);
  const mockDeductPoints = vi.mocked(deductPoints);
  const mockGetUserPoints = vi.mocked(getUserPoints);
  let store: Map<string, unknown>;

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    store = new Map<string, unknown>([[stateKey, createFarmState()]]);
    mockKvSet.mockImplementation(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    });
    mockKvGet.mockImplementation(async (key: string) => (store.has(key) ? store.get(key) : null) as any);
    mockKvDel.mockImplementation(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (store.delete(key)) deleted += 1;
      }
      return deleted;
    });
  });

  it('技能书支持一次购买多本', async () => {
    const result = await buyItem(userId, 'pet_skill_harvest', 2);
    const state = store.get(stateKey) as FarmStateV2;

    expect(result.ok).toBe(true);
    expect(state.inventory.pet_skill_harvest?.count).toBe(2);
    expect(state.purchasedSkillBooks?.pet_skill_harvest).toBeUndefined();
    expect(mockDeductPoints).toHaveBeenCalledWith(userId, 360, 'exchange', '农场购买: 收菜技能书 x2');
  });

  it('同一种技能书可以重复购买进入背包', async () => {
    const first = await buyItem(userId, 'pet_skill_plant', 1);
    const second = await buyItem(userId, 'pet_skill_plant', 2);
    const state = store.get(stateKey) as FarmStateV2;

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(state.inventory.pet_skill_plant?.count).toBe(3);
    expect(state.purchasedSkillBooks?.pet_skill_plant).toBeUndefined();
    expect(mockDeductPoints).toHaveBeenCalledTimes(2);
  });

  it('读取农场状态时同步积分总账余额', async () => {
    store.set(stateKey, { ...createFarmState(), points: 30 });
    mockGetUserPoints.mockResolvedValueOnce(100297);

    const status = await getFarmStatus(userId);
    const savedState = store.get(stateKey) as FarmStateV2;

    expect(status.state.points).toBe(100297);
    expect(savedState.points).toBe(100297);
  });

  it('读取农场状态时自动触发宠物收菜和种菜被动技能', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-06T00:00:00.000Z'));
    const now = Date.now();
    const state = createFarmState();
    state.bonuses.firstHarvest = true;
    state.pet = createAdultPet(['harvest', 'plant']);
    state.seedInventory = { wheat: 1 };
    state.lands = [
      {
        index: 1,
        status: 'mature',
        crop: {
          cropId: 'wheat',
          plantedAt: now - 31 * 60 * 1000,
          matureAt: now - 1000,
          lastWaterAt: now - 31 * 60 * 1000,
          nextWaterDueAt: now - 1000,
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
      { index: 2, status: 'empty', crop: null },
    ];
    store.set(stateKey, state);

    await getFarmStatus(userId);
    const savedState = store.get(stateKey) as FarmStateV2;

    expect(mockAddPoints).toHaveBeenCalledWith(userId, expect.any(Number), 'game_play', '宠物被动收菜: 1 块');
    expect(savedState.lands[0].status).toBe('growing');
    expect(savedState.lands[0].crop?.cropId).toBe('wheat');
    expect(savedState.seedInventory.wheat).toBe(0);
    expect(savedState.events.some((event) => event.text.includes('宠物收菜被动触发'))).toBe(true);
    expect(savedState.events.some((event) => event.text.includes('宠物种菜被动触发'))).toBe(true);
  });
});

function createFarmState(): FarmStateV2 {
  return {
    userId: 77,
    points: 1000,
    lands: [],
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
    bonuses: {
      firstWater: false,
      firstHarvest: false,
      firstAdopt: false,
    },
    createdAt: 0,
    updatedAt: 0,
  };
}

function createAdultPet(learnedSkills: PetState['learnedSkills'] = []): PetState {
  return {
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
    learnedSkills,
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
}
