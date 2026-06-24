import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { acquireNativeLock, hasNativeHotStoreBinding, releaseNativeLock } from '@/lib/hot-d1';
import { addPoints, applyPointsDelta, deductPoints, getUserPoints } from '@/lib/points';
import type { FarmStateV2, PetState } from '@/lib/types/farm-v2';
import { buyItem, buyItemWithStatus, buySeeds, getFarmStatus, processFarmMaturityEmails, recoverFarmPurchaseCompensations, useItemWithStatus } from '../index';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    mget: vi.fn(),
    set: vi.fn(),
    lpush: vi.fn(),
    lrange: vi.fn(),
    ltrim: vi.fn(),
    incrby: vi.fn(),
    decrby: vi.fn(),
    expire: vi.fn(),
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
  applyPointsDelta: vi.fn(async (_userId: number, amount: number) => ({ success: true, balance: 1000 + amount })),
  deductPoints: vi.fn(async (_userId: number, amount: number) => ({ success: true, balance: 1000 - amount })),
  getUserPoints: vi.fn(async () => 1000),
}));

describe('farm-v2 shop purchases', () => {
  const userId = 77;
  const stateKey = `farmv2:state:${userId}`;
  const mockKvSet = vi.mocked(kv.set);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvMget = vi.mocked(kv.mget);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockKvLrange = vi.mocked(kv.lrange);
  const mockKvLtrim = vi.mocked(kv.ltrim);
  const mockKvIncrby = vi.mocked(kv.incrby);
  const mockKvDecrby = vi.mocked(kv.decrby);
  const mockKvExpire = vi.mocked(kv.expire);
  const mockKvDel = vi.mocked(kv.del);
  const mockKvScan = vi.mocked(kv.scan);
  const mockAddPoints = vi.mocked(addPoints);
  const mockApplyPointsDelta = vi.mocked(applyPointsDelta);
  const mockDeductPoints = vi.mocked(deductPoints);
  const mockGetUserPoints = vi.mocked(getUserPoints);
  const mockAcquireNativeLock = vi.mocked(acquireNativeLock);
  const mockHasNativeHotStoreBinding = vi.mocked(hasNativeHotStoreBinding);
  const mockReleaseNativeLock = vi.mocked(releaseNativeLock);
  let store: Map<string, unknown>;

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockAcquireNativeLock.mockResolvedValue(true);
    mockHasNativeHotStoreBinding.mockReturnValue(false);
    store = new Map<string, unknown>([[stateKey, createFarmState()]]);
    mockKvSet.mockImplementation(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    });
    mockKvGet.mockImplementation(async (key: string) => (store.has(key) ? store.get(key) : null) as any);
    mockKvMget.mockImplementation(async (...keys: string[]) => keys.map((key) => (store.has(key) ? store.get(key) : null)) as any);
    mockKvLpush.mockImplementation(async (key: string, ...values: unknown[]) => {
      const list = (store.get(key) as unknown[] | undefined) ?? [];
      store.set(key, [...values, ...list]);
      return list.length + values.length;
    });
    mockKvLrange.mockImplementation(async (key: string, start: number, stop: number) => {
      const list = (store.get(key) as unknown[] | undefined) ?? [];
      const normalizedStop = stop < 0 ? list.length + stop : stop;
      return list.slice(start, normalizedStop + 1) as any;
    });
    mockKvLtrim.mockImplementation(async (key: string, start: number, stop: number) => {
      const list = (store.get(key) as unknown[] | undefined) ?? [];
      const normalizedStop = stop < 0 ? list.length + stop : stop;
      store.set(key, list.slice(start, normalizedStop + 1));
    });
    mockKvIncrby.mockImplementation(async (key: string, amount: number) => {
      const next = (Number(store.get(key)) || 0) + amount;
      store.set(key, next);
      return next;
    });
    mockKvDecrby.mockImplementation(async (key: string, amount: number) => {
      const next = (Number(store.get(key)) || 0) - amount;
      store.set(key, next);
      return next;
    });
    mockKvExpire.mockResolvedValue(1);
    mockKvDel.mockImplementation(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (store.delete(key)) deleted += 1;
      }
      return deleted;
    });
    mockKvScan.mockResolvedValue([0, []]);
    mockApplyPointsDelta.mockResolvedValue({ success: true, balance: 1000 });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('Cloudflare D1 binding 下农场锁走原生锁', async () => {
    mockHasNativeHotStoreBinding.mockReturnValue(true);

    const result = await buyItem(userId, 'pet_food_normal', 1);

    expect(result.ok).toBe(true);
    expect(mockAcquireNativeLock).toHaveBeenCalledWith(`farmv2:lock:${userId}`, expect.any(String), 6);
    expect(mockReleaseNativeLock).toHaveBeenCalledWith(`farmv2:lock:${userId}`, expect.any(String));
    expect(mockKvSet).not.toHaveBeenCalledWith(`farmv2:lock:${userId}`, expect.anything(), expect.anything());
  });

  it('读取农场状态时同步积分总账余额', async () => {
    store.set(stateKey, { ...createFarmState(), points: 30 });
    mockGetUserPoints.mockResolvedValueOnce(100297);

    const status = await getFarmStatus(userId);
    const savedState = store.get(stateKey) as FarmStateV2;

    expect(status.state.points).toBe(100297);
    expect(savedState.points).toBe(100297);
  });

  it('首次进入开心农场时无论原有积分多少都固定发放 100 积分', async () => {
    store.delete(stateKey);
    mockAddPoints.mockResolvedValueOnce({ success: true, balance: 1100 });
    mockGetUserPoints.mockResolvedValueOnce(1100);

    const status = await getFarmStatus(userId);
    const savedState = store.get(stateKey) as FarmStateV2;

    expect(mockAddPoints).toHaveBeenCalledWith(userId, 100, 'game_play', '开心农场初始积分');
    expect(status.state.points).toBe(1100);
    expect(savedState.points).toBe(1100);
  });

  it('首次进入开心农场初始积分发放失败时不保存农场存档', async () => {
    store.delete(stateKey);
    mockAddPoints.mockRejectedValueOnce(new Error('grant failed'));

    await expect(getFarmStatus(userId)).rejects.toThrow('grant failed');

    expect(store.has(stateKey)).toBe(false);
  });

  it('购买道具时直接返回最新农场状态', async () => {
    const result = await buyItemWithStatus(userId, 'pet_food_normal', 2);
    const savedState = store.get(stateKey) as FarmStateV2;
    const stateSaveCount = mockKvSet.mock.calls.filter(([key]) => key === stateKey).length;

    expect(result.ok).toBe(true);
    expect(result.balance).toBe(970);
    expect(result.data?.state.inventory.pet_food_normal?.count).toBe(2);
    expect(result.data?.shopDailyPurchases?.pet_food_normal).toBe(2);
    expect(savedState.inventory.pet_food_normal?.count).toBe(2);
    expect(stateSaveCount).toBe(1);
  });

  it('购买种子保存农场状态失败时自动退回积分', async () => {
    const state = createFarmState();
    state.lands = Array.from({ length: 4 }, (_, index) => ({
      index: index + 1,
      status: 'empty',
      crop: null,
    }));
    store.set(stateKey, state);
    mockKvSet.mockImplementation(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && store.has(key)) return null;
      if (key === stateKey) throw new Error('save failed');
      store.set(key, value);
      return 'OK';
    });

    const result = await buySeeds(userId, 'wheat', 2);

    expect(result.ok).toBe(false);
    expect(result.msg).toContain('已自动退回积分');
    expect(mockDeductPoints).toHaveBeenCalledWith(userId, 10, 'exchange', '农场购买种子: 小麦 x2');
    expect(mockApplyPointsDelta).toHaveBeenCalledWith(
      userId,
      10,
      'exchange_refund',
      expect.stringContaining('农场购买异常自动退款'),
    );
  });

  it('待补偿农场购买未检测到到账记录时自动退款', async () => {
    const txId = 'tx-pending-1';
    store.set(`farmv2:purchase:tx:list:${userId}`, [txId]);
    store.set(`farmv2:purchase:tx:${txId}`, {
      id: txId,
      userId,
      kind: 'seed',
      status: 'pending',
      pointsCost: 25,
      targetKey: 'wheat',
      quantity: 5,
      previousCount: 0,
      message: '购买小麦种子 x5',
      createdAt: 1,
      updatedAt: 1,
    });

    await recoverFarmPurchaseCompensations(userId);

    expect(mockApplyPointsDelta).toHaveBeenCalledWith(
      userId,
      25,
      'exchange_refund',
      expect.stringContaining('未检测到商品到账记录'),
    );
    expect(store.get(`farmv2:purchase:tx:${txId}`)).toEqual(
      expect.objectContaining({ status: 'refunded' }),
    );
  });

  it('使用道具时直接返回最新农场状态', async () => {
    const state = createFarmState();
    state.inventory.scarecrow = { count: 1, updatedAt: 0 };
    store.set(stateKey, state);

    const result = await useItemWithStatus(userId, 'scarecrow');
    const savedState = store.get(stateKey) as FarmStateV2;
    const stateSaveCount = mockKvSet.mock.calls.filter(([key]) => key === stateKey).length;

    expect(result.ok).toBe(true);
    expect(result.data?.state.scarecrowUntil).toBe(savedState.scarecrowUntil);
    expect(result.data?.state.inventory.scarecrow?.count).toBe(0);
    expect(savedState.inventory.scarecrow?.count).toBe(0);
    expect(stateSaveCount).toBe(1);
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
        status: 'growing',
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
    expect(savedState.events.some((event) => event.type === 'mature')).toBe(true);
    expect(savedState.events.some((event) => event.text.includes('宠物收菜被动触发'))).toBe(true);
    expect(savedState.events.some((event) => event.text.includes('宠物种菜被动触发'))).toBe(true);
  });

  it('后台农场扫描会自动触发宠物被动技能', async () => {
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
        status: 'growing',
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
    mockKvScan.mockResolvedValueOnce([0, [stateKey]]);

    const result = await processFarmMaturityEmails(10);
    const savedState = store.get(stateKey) as FarmStateV2;

    expect(result.processedUsers).toBe(1);
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
