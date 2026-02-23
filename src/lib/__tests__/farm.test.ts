import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { addGamePointsWithLimit, addPoints, deductPoints } from '../points';
import { getDailyPointsLimit } from '../config';
import { getOrCreateFarm, harvestPlot, waterPlot } from '../farm';
import type { FarmState } from '../types/farm';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
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

function createBaseFarmState(now: number): FarmState {
  return {
    userId: 1,
    level: 1,
    exp: 0,
    plots: [
      {
        index: 0,
        cropId: null,
        plantedAt: null,
        lastWateredAt: null,
        waterCount: 0,
        hasPest: false,
        pestAppearedAt: null,
        pestClearedAt: null,
        stage: 'seed',
        yieldMultiplier: 1,
      },
    ],
    unlockedCrops: ['wheat', 'carrot'],
    totalHarvests: 0,
    totalEarnings: 0,
    lastUpdatedAt: now,
    createdAt: now,
  };
}

describe('farm business consistency', () => {
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvDel = vi.mocked(kv.del);
  const mockDeductPoints = vi.mocked(deductPoints);
  const mockAddPoints = vi.mocked(addPoints);
  const mockAddGamePointsWithLimit = vi.mocked(addGamePointsWithLimit);
  const mockGetDailyPointsLimit = vi.mocked(getDailyPointsLimit);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // acquireFarmActionLock: kv.set with nx returns 'OK'
    mockKvSet.mockResolvedValue('OK');
    // releaseFarmActionLock: kv.get returns the lock token, kv.del succeeds
    mockKvGet.mockResolvedValue(null);
    mockKvDel.mockResolvedValue(1);
    mockDeductPoints.mockResolvedValue({ success: true, balance: 1000 });
    mockAddPoints.mockResolvedValue({ success: true, balance: 1000 });
    mockAddGamePointsWithLimit.mockResolvedValue({
      success: true,
      pointsEarned: 10,
      balance: 1010,
      dailyEarned: 10,
      limitReached: false,
    });
    mockGetDailyPointsLimit.mockResolvedValue(2000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getOrCreateFarm does not rewrite existing state during read refresh', async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const existing = createBaseFarmState(now);
    mockKvGet.mockResolvedValueOnce(existing);

    const farm = await getOrCreateFarm(1);

    expect(farm.userId).toBe(1);
    expect(mockKvSet).not.toHaveBeenCalled();
  });

  it('getOrCreateFarm normalizes legacy state without level reset', async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const legacy = {
      userId: 1,
      plots: Array.from({ length: 9 }, (_, index) => ({
        index,
        cropId: null,
        plantedAt: null,
        lastWateredAt: null,
        waterCount: 0,
        hasPest: false,
        pestAppearedAt: null,
        pestClearedAt: null,
        stage: 'seed',
        yieldMultiplier: 1,
      })),
      totalHarvests: 8,
      totalEarnings: 520,
      lastUpdatedAt: now - 60_000,
      createdAt: now - 120_000,
    } as unknown as FarmState;
    mockKvGet.mockResolvedValueOnce(legacy);

    const farm = await getOrCreateFarm(1);

    expect(farm.level).toBe(3);
    expect(farm.exp).toBeGreaterThanOrEqual(400);
    expect(farm.plots).toHaveLength(9);
    expect(farm.unlockedCrops).toEqual(expect.arrayContaining(['corn', 'pumpkin']));
    expect(mockKvSet).not.toHaveBeenCalled();
  });

  it('waterPlot rejects when plot currently does not need water', async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const farm = createBaseFarmState(now);
    farm.plots[0] = {
      index: 0,
      cropId: 'wheat',
      plantedAt: now,
      lastWateredAt: now,
      waterCount: 1,
      hasPest: false,
      pestAppearedAt: null,
      pestClearedAt: null,
      stage: 'seed',
      yieldMultiplier: 1,
    };

    // acquireFarmActionLock: kv.set returns 'OK'
    mockKvSet.mockResolvedValue('OK');
    // getOrCreateFarm: kv.get returns the farm state
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'farm:state:1') return farm;
      // releaseFarmActionLock: kv.get for the lock key returns the token
      if (key === 'farm:lock:action:1') return expect.any(String);
      return null;
    });

    const result = await waterPlot(1, 0);

    expect(result.success).toBe(false);
    expect(result.message).toBe('当前无需浇水');
    const stateSaveCalls = mockKvSet.mock.calls.filter(([key]) => key === 'farm:state:1');
    expect(stateSaveCalls).toHaveLength(0);
  });

  it('harvestPlot rolls farm state back when points settlement fails', async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const farm = createBaseFarmState(now);
    farm.plots[0] = {
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
    };

    // acquireFarmActionLock: kv.set returns 'OK'
    mockKvSet.mockResolvedValue('OK');
    // getOrCreateFarm: kv.get returns the farm state
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'farm:state:1') return farm;
      // releaseFarmActionLock: kv.get for the lock key returns the token
      if (key === 'farm:lock:action:1') return expect.any(String);
      return null;
    });
    mockAddGamePointsWithLimit.mockRejectedValueOnce(new Error('points failed'));

    const result = await harvestPlot(1, 0);

    expect(result.success).toBe(false);
    expect(result.message).toBe('积分结算失败，请稍后重试');

    const stateSaveCalls = mockKvSet.mock.calls.filter(([key]) => key === 'farm:state:1');
    expect(stateSaveCalls).toHaveLength(2);

    const firstSaved = stateSaveCalls[0]?.[1] as FarmState;
    const rollbackSaved = stateSaveCalls[1]?.[1] as FarmState;

    expect(firstSaved.plots[0]?.cropId).toBeNull();
    expect(rollbackSaved.plots[0]?.cropId).toBe('wheat');
  });
});
