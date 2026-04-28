import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drawCard, getUserCardData, updateUserCardData, selectCardByProbability, UserCards } from '../draw';
import { kv } from '@/lib/d1-kv';
import { CARDS } from '../config';
import { FRAGMENT_VALUES } from '../constants';
import { getNativeUserCards, isNativeHotStoreReady, setNativeUserCards } from '@/lib/hot-d1';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('@/lib/hot-d1', () => ({
  deleteNativeUserCards: vi.fn(),
  getNativeUserCards: vi.fn(),
  isNativeHotStoreReady: vi.fn(),
  setNativeUserCards: vi.fn(),
}));

vi.mock('../../economy-lock', () => ({
  withUserEconomyLock: vi.fn(async (_userId: string, handler: () => Promise<unknown>) => handler()),
}));

describe('Card Draw System', () => {
  const userId = 'user_123';
  const getFreshMockData = (): UserCards => ({
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
  const mockKvSet = vi.mocked(kv.set);
  const mockGetNativeUserCards = vi.mocked(getNativeUserCards);
  const mockIsNativeHotStoreReady = vi.mocked(isNativeHotStoreReady);
  const mockSetNativeUserCards = vi.mocked(setNativeUserCards);

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvSet.mockResolvedValue('OK');
    mockIsNativeHotStoreReady.mockResolvedValue(false);
    mockGetNativeUserCards.mockResolvedValue(null);
    mockSetNativeUserCards.mockResolvedValue(undefined);
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

    it('should read card data from native hot store when enabled', async () => {
      const nativeData = { ...getFreshMockData(), drawsAvailable: 8 };
      mockIsNativeHotStoreReady.mockResolvedValue(true);
      mockGetNativeUserCards.mockResolvedValue(nativeData);
      mockKvGet.mockResolvedValue(null);

      const data = await getUserCardData('123');

      expect(data).toEqual(nativeData);
      expect(mockGetNativeUserCards).toHaveBeenCalledWith(123);
      expect(kv.get).toHaveBeenCalledWith('cards:user:123');
      expect(mockSetNativeUserCards).not.toHaveBeenCalled();
    });

    it('should seed native hot store from legacy KV when native card data is missing', async () => {
      const legacyData = { ...getFreshMockData(), drawsAvailable: 6 };
      mockIsNativeHotStoreReady.mockResolvedValue(true);
      mockGetNativeUserCards.mockResolvedValue(null);
      mockKvGet.mockResolvedValue(legacyData);

      const data = await getUserCardData('123');

      expect(data).toEqual(legacyData);
      expect(kv.get).toHaveBeenCalledWith('cards:user:123');
      expect(mockSetNativeUserCards).toHaveBeenCalledWith(123, legacyData);
    });

    it('should merge split native and legacy card data', async () => {
      const nativeData = { ...getFreshMockData(), drawsAvailable: 9, inventory: ['animal-s1-common-仓鼠'] };
      const legacyData = { ...getFreshMockData(), drawsAvailable: 2, inventory: ['animal-s1-rare-柴犬'], fragments: 20 };
      mockIsNativeHotStoreReady.mockResolvedValue(true);
      mockGetNativeUserCards.mockResolvedValue(nativeData);
      mockKvGet.mockResolvedValue(legacyData);

      const data = await getUserCardData('123');

      expect(data.drawsAvailable).toBe(9);
      expect(data.fragments).toBe(20);
      expect(data.inventory).toEqual(expect.arrayContaining([
        'animal-s1-common-仓鼠',
        'animal-s1-rare-柴犬',
      ]));
      expect(mockSetNativeUserCards).toHaveBeenCalledWith(123, expect.objectContaining({
        drawsAvailable: 9,
        fragments: 20,
      }));
      expect(kv.set).toHaveBeenCalledWith('cards:user:123', expect.objectContaining({
        drawsAvailable: 9,
        fragments: 20,
      }));
    });
  });

  describe('updateUserCardData', () => {
    it('should store data in KV with correct key', async () => {
      const newData = { ...getFreshMockData(), inventory: ['animal-s1-common-仓鼠'] };
      await updateUserCardData(userId, newData);
      expect(kv.set).toHaveBeenCalledWith(`cards:user:${userId}`, newData);
    });

    it('should store data in native hot store when enabled', async () => {
      const newData = { ...getFreshMockData(), drawsAvailable: 9 };
      mockIsNativeHotStoreReady.mockResolvedValue(true);

      await updateUserCardData('123', newData);

      expect(mockSetNativeUserCards).toHaveBeenCalledWith(123, newData);
      expect(kv.set).toHaveBeenCalledWith('cards:user:123', newData);
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
      // Phase 1: reserveDraw reads user data with 0 draws
      mockKvGet.mockResolvedValueOnce({ ...getFreshMockData(), drawsAvailable: 0 });

      const result = await drawCard(userId);
      expect(result).toEqual({ success: false, message: '抽卡次数不足' });
      // Only kv.get should be called (no kv.set since reserve fails early)
      expect(kv.get).toHaveBeenCalledTimes(1);
      expect(kv.set).not.toHaveBeenCalled();
    });

    it('should return a card and update user data on success', async () => {
      const userData = getFreshMockData();
      // Phase 1: reserveDraw reads user data (has 1 draw available)
      mockKvGet.mockResolvedValueOnce({ ...userData });
      // Phase 2: finalizeDraw reads user data (after reserve decremented draws)
      mockKvGet.mockResolvedValueOnce({
        ...userData,
        drawsAvailable: 0,
        pityRare: 1,
        pityEpic: 1,
        pityLegendary: 1,
        pityLegendaryRare: 1,
        pityCounter: 1,
      });

      const result = await drawCard(userId);

      expect(result.success).toBe(true);
      expect(result.card).toBeDefined();
      expect(CARDS).toContain(result.card);
      expect(result.isDuplicate).toBe(false);

      // Verify kv.get called twice (phase 1 + phase 2) and kv.set called twice
      expect(kv.get).toHaveBeenCalledTimes(2);
      expect(kv.set).toHaveBeenCalledTimes(2);
    });

    it('should handle duplicate cards and return fragments', async () => {
      const userData: UserCards = {
        ...getFreshMockData(),
        inventory: CARDS.map(c => c.id), // all cards in inventory = guaranteed duplicate
      };

      // Phase 1: reserveDraw reads user data
      mockKvGet.mockResolvedValueOnce({ ...userData });
      // Phase 2: finalizeDraw reads user data (after reserve)
      mockKvGet.mockResolvedValueOnce({
        ...userData,
        drawsAvailable: 0,
        pityRare: 1,
        pityEpic: 1,
        pityLegendary: 1,
        pityLegendaryRare: 1,
        pityCounter: 1,
      });

      const result = await drawCard(userId);

      expect(result.success).toBe(true);
      expect(result.card).toBeDefined();
      expect(result.isDuplicate).toBe(true);
      expect(result.fragmentsAdded).toBe(FRAGMENT_VALUES[result.card!.rarity]);
    });
  });
});
