import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { addPoints } from '@/lib/points';
import { getCustomUserProfile } from '@/lib/user-profile';
import type { FarmStateV2, LandPlot, PetState } from '@/lib/types/farm-v2';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    scan: vi.fn(),
  },
}));

vi.mock('@/lib/hot-d1', () => ({
  acquireNativeLock: vi.fn(async () => true),
  hasNativeHotStoreBinding: vi.fn(() => false),
  releaseNativeLock: vi.fn(),
}));

vi.mock('@/lib/points', () => ({
  addPoints: vi.fn(async (_userId: number, amount: number) => ({ success: true, balance: amount })),
  deductPoints: vi.fn(async (_userId: number, amount: number) => ({ success: true, balance: 1000 - amount })),
  getUserPoints: vi.fn(async () => 1000),
}));

vi.mock('@/lib/user-profile', () => ({
  getCustomUserProfile: vi.fn(async () => ({})),
}));

import { executeSteal, listStealCandidates } from '../index';
import { pickRandomStealableMatureIndex } from '../steal';

describe('farm-v2 steal', () => {
  const thiefId = 101;
  const targetId = 202;
  const thiefKey = `farmv2:state:${thiefId}`;
  const targetKey = `farmv2:state:${targetId}`;
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvDel = vi.mocked(kv.del);
  const mockKvScan = vi.mocked(kv.scan);
  const mockAddPoints = vi.mocked(addPoints);
  const mockGetCustomUserProfile = vi.mocked(getCustomUserProfile);
  let store: Map<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-06T00:00:00.000Z'));
    vi.restoreAllMocks();
    store = new Map<string, unknown>([
      [thiefKey, createFarmState(thiefId, createStealPet())],
      [targetKey, createFarmState(targetId, null, [createMatureLand(1, 'wheat')])],
      [`user:${targetId}`, { nickname: '旧昵称', email: 'target@example.com' }],
    ]);
    mockKvGet.mockImplementation(async (key: string) => (store.has(key) ? store.get(key) : null) as any);
    mockKvSet.mockImplementation(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    });
    mockKvDel.mockImplementation(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (store.delete(key)) deleted += 1;
      }
      return deleted;
    });
    mockKvScan.mockResolvedValue([0, [thiefKey, targetKey]]);
    mockAddPoints.mockImplementation(async (_userId: number, amount: number) => ({ success: true, balance: amount }));
    mockGetCustomUserProfile.mockResolvedValue({ displayName: '头像玩家', avatarUrl: 'https://example.com/a.png' });
  });

  it('偷菜候选只返回用户信息，不暴露成熟作物', async () => {
    const candidates = await listStealCandidates(thiefId);

    expect(candidates).toEqual([
      { userId: targetId, nickname: '头像玩家', avatarUrl: 'https://example.com/a.png' },
    ]);
    expect('matureLands' in candidates[0]).toBe(false);
  });

  it('随机选择可偷成熟作物', () => {
    const state = createFarmState(targetId, null, [
      createMatureLand(1, 'wheat'),
      createMatureLand(2, 'carrot'),
    ]);

    expect(pickRandomStealableMatureIndex(state, () => 0)).toBe(0);
    expect(pickRandomStealableMatureIndex(state, () => 0.99)).toBe(1);
  });

  it('偷菜成功后整棵作物被偷走，目标用户没有收获', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const result = await executeSteal(thiefId, targetId);
    const thief = store.get(thiefKey) as FarmStateV2;
    const target = store.get(targetKey) as FarmStateV2;

    expect(result.ok).toBe(true);
    expect(result.success).toBe(true);
    expect(result.amount).toBeGreaterThan(0);
    expect(result.cropName).toBe('小麦');
    expect(target.lands[0].status).toBe('empty');
    expect(target.lands[0].crop).toBeNull();
    expect(target.stolenTodayCount).toBe(1);
    expect(target.events[0]?.text).toContain('被整棵偷走了');
    expect(mockAddPoints).toHaveBeenCalledWith(thiefId, result.amount, 'game_play', '偷菜成功: 202 的 小麦');
    expect(thief.events[0]?.text).toContain(`+${result.amount} 积分`);
  });
});

function createFarmState(userId: number, pet: PetState | null, lands: LandPlot[] = []): FarmStateV2 {
  return {
    userId,
    points: 1000,
    lands: [
      ...lands,
      ...Array.from({ length: Math.max(0, 8 - lands.length) }, (_, index) => ({
        index: lands.length + index + 1,
        status: 'empty' as const,
        crop: null,
      })),
    ],
    scarecrowUntil: null,
    bellUntil: null,
    pet,
    stolenTodayCount: 0,
    stolenByMap: {},
    myStealMap: {},
    inventory: {},
    purchasedSkillBooks: {},
    seedInventory: {},
    events: [],
    lastDailyResetAt: Date.now(),
    lastSeasonProcessedAt: Date.now(),
    lastTickAt: Date.now(),
    bonuses: {
      firstWater: false,
      firstHarvest: true,
      firstAdopt: true,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createStealPet(): PetState {
  return {
    type: 'cat',
    name: '雪球',
    stage: 'adult',
    growth: 200,
    hunger: 90,
    cleanliness: 90,
    mood: 90,
    thirst: 90,
    hydrationVersion: 2,
    health: 90,
    learnedSkills: ['steal'],
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
    dailyResetAt: Date.now(),
  };
}

function createMatureLand(index: number, cropId: 'wheat' | 'carrot'): LandPlot {
  const now = Date.now();
  return {
    index,
    status: 'mature',
    crop: {
      cropId,
      plantedAt: now - 60 * 60 * 1000,
      matureAt: now - 1000,
      lastWaterAt: now - 60 * 60 * 1000,
      nextWaterDueAt: now + 60 * 60 * 1000,
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
  };
}
