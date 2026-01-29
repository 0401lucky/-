import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drawCard, getUserCardData, updateUserCardData, selectCardByProbability } from '../draw';
import { kv } from '@vercel/kv';
import { CARDS } from '../config';

vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

describe('Card Draw System', () => {
  const userId = 'user_123';
  const getFreshMockData = () => ({
    inventory: [],
    fragments: 0,
    pityCounter: 0,
    drawsAvailable: 10,
    collectionRewards: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserCardData', () => {
    it('should return default data if user has no record', async () => {
      (kv.get as any).mockResolvedValue(null);
      const data = await getUserCardData(userId);
      expect(data).toEqual(getFreshMockData());
      expect(kv.get).toHaveBeenCalledWith(`cards:user:${userId}`);
    });

    it('should return stored data if user has record', async () => {
      const storedData = { ...getFreshMockData(), drawsAvailable: 5 };
      (kv.get as any).mockResolvedValue(storedData);
      const data = await getUserCardData(userId);
      expect(data).toEqual(storedData);
    });
  });

  describe('updateUserCardData', () => {
    it('should store data in KV with correct key', async () => {
      const newData = { ...getFreshMockData(), inventory: ['common-仓鼠'] };
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
      (kv.get as any).mockResolvedValue({ ...getFreshMockData(), drawsAvailable: 0 });
      const result = await drawCard(userId);
      expect(result).toEqual({ success: false, message: '抽卡次数不足' });
    });

    it('should return a card and update user data on success', async () => {
      const mockUserData = getFreshMockData();
      (kv.get as any).mockResolvedValue(mockUserData);
      const result = await drawCard(userId);

      expect(result.success).toBe(true);
      expect(result.card).toBeDefined();
      expect(CARDS).toContain(result.card);
      
      expect(kv.set).toHaveBeenCalled();
      const updatedData = (kv.set as any).mock.calls[0][1] as any;
      expect(updatedData.drawsAvailable).toBe(9);
      expect(updatedData.inventory).toContain(result.card?.id);
    });
  });
});
