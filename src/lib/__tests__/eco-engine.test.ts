import { describe, expect, it } from 'vitest';
import {
  ECO_ITEM_KEYS,
  ECO_LUCKY_PRIZE_RATE,
  ECO_PRIZE_TTL_MS,
  ECO_PRIZES,
  ECO_PRIZE_KEYS,
  convertBuffer,
  createInitialEcoState,
  getEcoPrizePrice,
  getGrabSize,
  getUpgradeCost,
  normalizeEcoState,
  pruneExpiredVisiblePrizes,
  rollEcoGeneratedPrize,
  rollEcoPrize,
  rollEcoPrizes,
  tickEco,
} from '../eco-engine';
import type { EcoState } from '../types/eco';

describe('eco engine rules', () => {
  it('uses fixed upgrade costs from the economy plan', () => {
    expect(getUpgradeCost('spawn', 0)).toBe(50);
    expect(getUpgradeCost('spawn', 7)).toBe(2400);
    expect(getUpgradeCost('spawn', 8)).toBeNull();

    expect(getUpgradeCost('storage', 0)).toBe(40);
    expect(getUpgradeCost('value', 4)).toBe(2600);
    expect(getUpgradeCost('auto', 5)).toBe(5600);
  });

  it('rolls each prize independently with rare prize rates', () => {
    expect(ECO_PRIZES.trophy.spawnRate).toBe(0.0005);
    expect(ECO_PRIZES.necklace.spawnRate).toBe(0.0003);
    expect(ECO_PRIZES.coin.spawnRate).toBe(0.0001);
    expect(ECO_PRIZES.diamond.spawnRate).toBe(0.00005);
    expect(ECO_PRIZES.photo.spawnRate).toBe(0.00001);

    expect(rollEcoPrizes(() => 0)).toEqual([
      'diamond',
      'coin',
      'necklace',
      'trophy',
      'photo',
    ]);
    expect(rollEcoPrizes(() => 0.0005)).toEqual([]);
    expect(rollEcoPrize(() => 0)).toBe('diamond');
  });

  it('rolls one generated item as either a prize or normal trash', () => {
    expect(rollEcoGeneratedPrize(() => 0)).toBe('diamond');
    expect(rollEcoGeneratedPrize(() => 0.00005)).toBe('coin');
    expect(rollEcoGeneratedPrize(() => 0.00097)).toBeNull();
  });

  it('boosts generated prize rates by 10x for lucky flashlight', () => {
    expect(ECO_LUCKY_PRIZE_RATE).toBe(10);
    expect(ECO_PRIZES.trophy.spawnRate * ECO_LUCKY_PRIZE_RATE).toBe(0.005);
    expect(rollEcoGeneratedPrize(() => 0.005)).toBeNull();
    expect(rollEcoGeneratedPrize(() => 0.005, ECO_LUCKY_PRIZE_RATE)).toBe('trophy');
  });

  it('uses the same generation slot for either prize or trash', () => {
    const now = 1_700_000_000_000;
    const state = createInitialEcoState(1001, now - 6_000);

    const tick = tickEco(state, now, { rollPrize: () => 'coin' });

    expect(tick.spawned).toBe(1);
    expect(tick.acceptedSpawned).toBe(1);
    expect(tick.trashSpawned).toBe(0);
    expect(tick.prizeKeys).toEqual(['coin']);
    expect(state.pending).toBe(0);
  });

  it('does not generate prizes when storage capacity is already full', () => {
    const now = 1_700_000_000_000;
    const state = createInitialEcoState(1001, now - 60_000);
    state.pending = 80;

    const tick = tickEco(state, now, { rollPrize: () => 'diamond' });

    expect(tick.spawned).toBe(10);
    expect(tick.acceptedSpawned).toBe(0);
    expect(tick.prizeKeys).toEqual([]);
    expect(state.pending).toBe(80);
  });

  it('keeps daily prize prices deterministic and inside new ranges', () => {
    const date = '2026-06-08';
    const ranges = {
      diamond: [1000, 15000],
      coin: [1000, 9000],
      necklace: [1000, 7000],
      trophy: [500, 5000],
      photo: [5000, 50000],
    } as const;

    for (const key of ECO_PRIZE_KEYS) {
      const first = getEcoPrizePrice(key, date);
      const second = getEcoPrizePrice(key, date);
      const [min, max] = ranges[key];
      expect(first).toBe(second);
      expect(first).toBeGreaterThanOrEqual(min);
      expect(first).toBeLessThanOrEqual(max);
    }
  });

  it('moves prize prices down when yesterday acquisition share is high', () => {
    const date = '2026-06-09';
    const scarce = getEcoPrizePrice('trophy', date, { total: 100 });
    const abundant = getEcoPrizePrice('trophy', date, { trophy: 100, total: 100 });
    expect(abundant).toBeLessThan(scarce);
  });

  it('normalizes old saves and tracks one-time item state', () => {
    const now = 1_700_000_000_000;
    const oldSave = {
      ...createInitialEcoState(1001, now - 1000),
      upgrades: { spawn: 2, storage: 1, value: 0, auto: 0, grab: 4 },
      inventory: { diamond: 2 },
      visiblePrizes: [
        { id: 'p1', key: 'coin', createdAt: now - ECO_PRIZE_TTL_MS },
        { id: 'p2', key: 'photo', createdAt: now - ECO_PRIZE_TTL_MS - 1 },
      ],
      gloveUsesRemaining: 3,
      itemPurchases: { clear_truck: { date: '2026-06-08', count: 1 } },
    } as unknown as EcoState;

    const normalized = normalizeEcoState(oldSave, now);
    expect(normalized.upgrades).toEqual({ spawn: 2, storage: 1, value: 0, auto: 0 });
    expect(normalized.inventory.diamond).toBe(2);
    expect(normalized.inventory.coin).toBe(0);
    expect(normalized.lifetimePrizeClaims).toBe(2);
    expect(normalized.lifetimePrizeClaimCounts.diamond).toBe(2);
    expect(normalized.visiblePrizes).toHaveLength(1);
    expect(normalized.visiblePrizes[0]?.id).toBe('p1');
    expect(normalized.gloveUsesRemaining).toBe(3);
    expect(normalized.itemPurchases.clear_truck?.count).toBe(1);
    expect(getGrabSize(normalized)).toBe(2);
    expect(ECO_ITEM_KEYS).toEqual(['clear_truck', 'lucky_flashlight', 'recycle_glove']);
  });

  it('expires visible prizes after ten minutes', () => {
    const now = 1_700_000_000_000;
    const state = createInitialEcoState(1001, now);
    state.visiblePrizes = [
      { id: 'fresh', key: 'coin', createdAt: now - ECO_PRIZE_TTL_MS + 1 },
      { id: 'expired', key: 'diamond', createdAt: now - ECO_PRIZE_TTL_MS - 1 },
    ];

    expect(pruneExpiredVisiblePrizes(state, now)).toBe(1);
    expect(state.visiblePrizes.map((prize) => prize.id)).toEqual(['fresh']);
  });

  it('converts buffered trash without a daily points cap by default', () => {
    expect(convertBuffer(35, 2)).toEqual({
      pointsToAward: 6,
      batches: 3,
      newBuffer: 5,
    });
  });
});
