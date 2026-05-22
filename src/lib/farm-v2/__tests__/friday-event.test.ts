import { describe, expect, it, vi } from 'vitest';
import type { FarmStateV2 } from '@/lib/types/farm-v2';

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

import { tickFarm } from '../index';

function chinaNoonUtc(year: number, monthIndex: number, day: number): number {
  return Date.UTC(year, monthIndex, day, 4, 0, 0);
}

function createFarmState(userId: number, now: number): FarmStateV2 {
  return {
    userId,
    points: 100,
    lands: Array.from({ length: 8 }, (_, i) => ({
      index: i + 1,
      status: i < 4 ? 'empty' : 'locked',
      crop: null,
    })),
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
    lastDailyResetAt: now,
    lastSeasonProcessedAt: now,
    lastTickAt: now - 1000,
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

function seedTotal(state: FarmStateV2): number {
  return Object.values(state.seedInventory)
    .reduce<number>((sum, count) => sum + (count ?? 0), 0);
}

describe('farm-v2 friday random event', () => {
  it('周五会触发一次随机事件并记录日期', () => {
    const fridayNoon = chinaNoonUtc(2026, 4, 15);
    const state = createFarmState(4, fridayNoon);

    tickFarm(state, fridayNoon);
    tickFarm(state, fridayNoon + 1000);

    expect(state.lastFridayEventDate).toBe('2026-05-15');
    expect(state.events).toHaveLength(1);
    expect(state.events[0]?.type).toBe('friday_event');
    expect(state.events[0]?.text).toContain('周五随机事件');
    expect(seedTotal(state)).toBe(2);
  });

  it('非周五不会触发随机事件', () => {
    const thursdayNoon = chinaNoonUtc(2026, 4, 14);
    const state = createFarmState(4, thursdayNoon);

    tickFarm(state, thursdayNoon);

    expect(state.lastFridayEventDate).toBe('');
    expect(state.events).toHaveLength(0);
    expect(seedTotal(state)).toBe(0);
  });
});
