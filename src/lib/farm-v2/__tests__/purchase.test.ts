import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { deductPoints } from '@/lib/points';
import type { FarmStateV2 } from '@/lib/types/farm-v2';
import { buyItem } from '../index';

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
  const mockDeductPoints = vi.mocked(deductPoints);
  let store: Map<string, unknown>;

  beforeEach(() => {
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

  it('技能书单次购买数量只能为 1 本', async () => {
    const result = await buyItem(userId, 'pet_skill_harvest', 2);
    const state = store.get(stateKey) as FarmStateV2;

    expect(result.ok).toBe(false);
    expect(result.msg).toBe('技能书每种限购 1 本');
    expect(state.inventory.pet_skill_harvest).toBeUndefined();
    expect(mockDeductPoints).not.toHaveBeenCalled();
  });

  it('同一种技能书购买后不能重复购买', async () => {
    const first = await buyItem(userId, 'pet_skill_plant', 1);
    const second = await buyItem(userId, 'pet_skill_plant', 1);
    const state = store.get(stateKey) as FarmStateV2;

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.msg).toBe('该技能书已购买，不能重复购买');
    expect(state.inventory.pet_skill_plant?.count).toBe(1);
    expect(state.purchasedSkillBooks?.pet_skill_plant).toBe(true);
    expect(mockDeductPoints).toHaveBeenCalledTimes(1);
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
