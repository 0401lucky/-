import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FarmState } from '../types/farm';
import type { FarmShopItem } from '../types/farm-shop';
import { kv } from '@/lib/d1-kv';
import { addGamePointsWithLimit, addPoints, deductPoints } from '../points';
import { getDailyPointsLimit } from '../config';
import { getOrCreateFarm } from '../farm';
import { applyAutoHarvest, purchaseFarmShopItem } from '../farm-shop';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    hget: vi.fn(),
    hgetall: vi.fn(),
    hset: vi.fn(),
    lpush: vi.fn(),
    ltrim: vi.fn(),
    hincrby: vi.fn(),
    incrby: vi.fn(),
    decrby: vi.fn(),
    expire: vi.fn(),
  },
}));

vi.mock('../points', () => ({
  deductPoints: vi.fn(),
  addPoints: vi.fn(),
  addGamePointsWithLimit: vi.fn(),
}));

vi.mock('../config', () => ({
  getDailyPointsLimit: vi.fn(),
}));

vi.mock('../time', () => ({
  getTodayDateString: vi.fn(() => '2026-01-01'),
}));

vi.mock('../farm', () => ({
  getOrCreateFarm: vi.fn(),
}));

function createFarmState(now: number): FarmState {
  return {
    userId: 1,
    level: 1,
    exp: 0,
    plots: [
      {
        index: 0,
        cropId: 'wheat',
        plantedAt: now - 10 * 60 * 1000,
        lastWateredAt: now - 2 * 60 * 1000,
        waterCount: 2,
        hasPest: false,
        pestAppearedAt: null,
        pestClearedAt: null,
        stage: 'growing',
        yieldMultiplier: 1,
      },
    ],
    unlockedCrops: ['wheat', 'carrot'],
    totalHarvests: 0,
    totalEarnings: 0,
    lastUpdatedAt: now - 60_000,
    createdAt: now - 120_000,
    activeBuffs: [],
    inventory: {},
  };
}

function createAutoHarvestItem(): FarmShopItem {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  return {
    id: 'auto-harvest-item',
    name: '自动收割机',
    icon: '🤖',
    description: '自动收获成熟作物，12小时内成熟即收',
    effect: 'auto_harvest',
    mode: 'buff',
    pointsCost: 260,
    durationMs: 12 * 60 * 60 * 1000,
    sortOrder: 2,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe('farm-shop auto harvest integration', () => {
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvHget = vi.mocked(kv.hget);
  const mockKvHgetall = vi.mocked(kv.hgetall);
  const mockKvHset = vi.mocked(kv.hset);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockKvLtrim = vi.mocked(kv.ltrim);
  const mockKvHincrby = vi.mocked(kv.hincrby);
  const mockDeductPoints = vi.mocked(deductPoints);
  const mockAddPoints = vi.mocked(addPoints);
  const mockAddGamePointsWithLimit = vi.mocked(addGamePointsWithLimit);
  const mockGetDailyPointsLimit = vi.mocked(getDailyPointsLimit);
  const mockGetOrCreateFarm = vi.mocked(getOrCreateFarm);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockKvSet.mockResolvedValue('OK');
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'farm:shop:defaults:version') return 2;
      return null;
    });
    mockKvHset.mockResolvedValue(1);
    mockKvLpush.mockResolvedValue(1);
    mockKvLtrim.mockResolvedValue(undefined);
    mockKvHincrby.mockResolvedValue(1);
    mockDeductPoints.mockResolvedValue({ success: true, balance: 740 });
    mockAddPoints.mockResolvedValue({ success: true, balance: 1000 });
    mockAddGamePointsWithLimit.mockResolvedValue({
      success: true,
      pointsEarned: 20,
      balance: 760,
      dailyEarned: 120,
      limitReached: false,
    });
    mockGetDailyPointsLimit.mockResolvedValue(2000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applyAutoHarvest returns settlement data when auto_harvest buff is active', async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const farm = createFarmState(now);
    farm.activeBuffs = [{
      itemId: 'auto-harvest-item',
      effect: 'auto_harvest',
      activatedAt: now - 60_000,
      expiresAt: now + 12 * 60 * 60 * 1000,
    }];
    mockGetOrCreateFarm.mockResolvedValue(farm);

    const result = await applyAutoHarvest(farm, 1, 'sunny', now);

    expect(result.autoHarvestedCount).toBe(1);
    expect(result.autoHarvestPoints).toBe(20);
    expect(result.newBalance).toBe(760);
    expect(result.dailyEarned).toBe(120);
    expect(result.limitReached).toBe(false);
    expect(result.farmState.plots[0]?.cropId).toBeNull();
    expect(result.farmState.totalHarvests).toBe(1);
    expect(result.farmState.totalEarnings).toBe(20);
  });

  it('purchaseFarmShopItem immediately settles mature crops for auto_harvest buff', async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const farm = createFarmState(now);
    const item = createAutoHarvestItem();
    mockGetOrCreateFarm.mockResolvedValue(farm);
    mockKvHgetall.mockResolvedValue({ [item.id]: item });
    mockKvHget.mockResolvedValue(item);

    const result = await purchaseFarmShopItem(1, item.id);

    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(760);
    expect(result.dailyEarned).toBe(120);
    expect(result.limitReached).toBe(false);
    expect(result.farmState?.activeBuffs?.some(buff => buff.effect === 'auto_harvest')).toBe(true);
    expect(result.farmState?.plots[0]?.cropId).toBeNull();
    expect(result.farmState?.totalHarvests).toBe(1);
    expect(result.farmState?.totalEarnings).toBe(20);

    const stateSaveCalls = mockKvSet.mock.calls.filter(([key]) => key === 'farm:state:1');
    expect(stateSaveCalls.length).toBeGreaterThanOrEqual(2);
  });
});
