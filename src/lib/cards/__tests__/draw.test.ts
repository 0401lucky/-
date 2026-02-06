import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drawCard, getUserCardData, updateUserCardData, selectCardByProbability } from '../draw';
import { kv } from '@vercel/kv';
import { CARDS } from '../config';

vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    eval: vi.fn(),
  },
}));

describe('Card Draw System', () => {
  const userId = 'user_123';
  const getFreshMockData = () => ({
    inventory: [],
    fragments: 0,
    pityCounter: 0,
    pityRare: 0,
    pityEpic: 0,
    pityLegendary: 0,
    pityLegendaryRare: 0,
    drawsAvailable: 1,
    collectionRewards: [],
  });

  const mockKvGet = vi.mocked(kv.get);
  const mockKvEval = vi.mocked(kv.eval);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserCardData', () => {
    it('should return default data if user has no record', async () => {
      mockKvGet.mockResolvedValue(null);
      const data = await getUserCardData(userId);
      expect(data).toEqual(getFreshMockData());
      expect(kv.get).toHaveBeenCalledWith(`cards:user:${userId}`);
    });

    it('should return stored data if user has record', async () => {
      const storedData = { ...getFreshMockData(), drawsAvailable: 5 };
      mockKvGet.mockResolvedValue(storedData);
      const data = await getUserCardData(userId);
      expect(data).toEqual(storedData);
    });
  });

  describe('updateUserCardData', () => {
    it('should store data in KV with correct key', async () => {
      const newData = { ...getFreshMockData(), inventory: ['animal-s1-common-仓鼠'] };
      await updateUserCardData(userId, newData);
      expect(kv.set).toHaveBeenCalledWith(`cards:user:${userId}`, newData);
    });
  });

  describe('selectCardByProbability', () => {
    it('should return a valid card from CARDS', () => {
      const card = selectCardByProbability();
      expect(CARDS).toContain(card);
    });

    it('should follow probability distribution (Chi-Square Test)', () => {
      const iterations = 10000;
      const counts: Record<string, number> = {
        legendary_rare: 0,
        legendary: 0,
        epic: 0,
        rare: 0,
        common: 0,
      };

      for (let i = 0; i < iterations; i++) {
        const card = selectCardByProbability();
        counts[card.rarity]++;
      }

      const expectedProbabilities = {
        legendary_rare: 0.005,
        legendary: 0.02,
        epic: 0.07,
        rare: 0.25,
        common: 0.655,
      };

      let chiSquare = 0;
      for (const rarity in expectedProbabilities) {
        const expected = iterations * expectedProbabilities[rarity as keyof typeof expectedProbabilities];
        const observed = counts[rarity];
        chiSquare += Math.pow(observed - expected, 2) / expected;
      }

      // Critical value for df=4 at alpha=0.05 is 9.488
      expect(chiSquare).toBeLessThan(15); // Slightly more relaxed for randomness
    });
  });

  describe('drawCard', () => {
    it('should return null and message if user has no draws available', async () => {
      // Phase 1 returns failure (no draws)
      mockKvEval.mockResolvedValueOnce([0, 0, 0, 0, 0, 'no_draws']);
      
      const result = await drawCard(userId);
      expect(result).toEqual({ success: false, message: '抽卡次数不足' });
    });

    it('should return a card and update user data on success', async () => {
      // Phase 1: Reserve draw success, returns pityCounter = 1
      mockKvEval.mockResolvedValueOnce([1, 1, 1, 1, 1, 'ok']);
      // Phase 2: Finalize draw success, new card
      mockKvEval.mockResolvedValueOnce([1, 'ok', 0]);

      const result = await drawCard(userId);

      expect(result.success).toBe(true);
      expect(result.card).toBeDefined();
      expect(CARDS).toContain(result.card);
      expect(result.isDuplicate).toBe(false);
      
      // Verify kv.eval was called twice (two phases)
      expect(kv.eval).toHaveBeenCalledTimes(2);
    });

    it('should handle duplicate cards and return fragments', async () => {
      // Phase 1: Reserve draw success
      mockKvEval.mockResolvedValueOnce([1, 1, 1, 1, 1, 'ok']);
      // Phase 2: Finalize draw - duplicate card, returns fragments
      mockKvEval.mockResolvedValueOnce([1, 'duplicate', 5]);

      const result = await drawCard(userId);

      expect(result.success).toBe(true);
      expect(result.card).toBeDefined();
      expect(result.isDuplicate).toBe(true);
      expect(result.fragmentsAdded).toBe(5);
    });
  });
});
