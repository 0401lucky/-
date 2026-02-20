import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDuplicateCard, exchangeFragmentsForCard, getFragmentValue, getExchangePrice } from '../fragments';
import { kv } from '@/lib/d1-kv';
import { FRAGMENT_VALUES, EXCHANGE_PRICES } from '../constants';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

describe('Card Fragment System', () => {
  const userId = 'user_123';
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvSet.mockResolvedValue('OK');
  });

  describe('Utility Functions', () => {
    it('getFragmentValue should return correct values', () => {
      expect(getFragmentValue('common')).toBe(FRAGMENT_VALUES.common);
      expect(getFragmentValue('legendary_rare')).toBe(FRAGMENT_VALUES.legendary_rare);
    });

    it('getExchangePrice should return correct values', () => {
      expect(getExchangePrice('common')).toBe(EXCHANGE_PRICES.common);
      expect(getExchangePrice('legendary_rare')).toBe(EXCHANGE_PRICES.legendary_rare);
    });
  });

  describe('handleDuplicateCard', () => {
    it('should add card to inventory if it is new', async () => {
      const cardId = 'animal-s1-common-仓鼠';
      // D1-compatible: kv.get returns user data without the card in inventory
      mockKvGet.mockResolvedValue({ inventory: [], fragments: 0, pityCounter: 0, drawsAvailable: 1, collectionRewards: {} });

      const result = await handleDuplicateCard(userId, cardId);

      expect(result.isDuplicate).toBe(false);
      expect(result.fragmentsAdded).toBe(0);
      expect(kv.get).toHaveBeenCalledWith(`cards:user:${userId}`);
      expect(kv.set).toHaveBeenCalledWith(
        `cards:user:${userId}`,
        expect.objectContaining({
          inventory: expect.arrayContaining([cardId]),
        })
      );
    });

    it('should convert to fragments if card is duplicate', async () => {
      const cardId = 'animal-s1-common-仓鼠';
      const fragmentValue = FRAGMENT_VALUES.common;
      // D1-compatible: kv.get returns user data with the card already in inventory
      mockKvGet.mockResolvedValue({ inventory: [cardId], fragments: 10, pityCounter: 0, drawsAvailable: 1, collectionRewards: {} });

      const result = await handleDuplicateCard(userId, cardId);

      expect(result.isDuplicate).toBe(true);
      expect(result.fragmentsAdded).toBe(fragmentValue);
      expect(kv.set).toHaveBeenCalledWith(
        `cards:user:${userId}`,
        expect.objectContaining({
          fragments: 10 + fragmentValue,
        })
      );
    });
  });

  describe('exchangeFragmentsForCard', () => {
    it('should exchange fragments for a card successfully', async () => {
      const cardId = 'animal-s1-rare-柴犬';
      const exchangePrice = EXCHANGE_PRICES.rare;
      // D1-compatible: kv.get returns user data with enough fragments and without the card
      mockKvGet.mockResolvedValue({ inventory: [], fragments: 100, pityCounter: 0, drawsAvailable: 1, collectionRewards: {} });

      const result = await exchangeFragmentsForCard(userId, cardId);

      expect(result.success).toBe(true);
      expect(kv.get).toHaveBeenCalledWith(`cards:user:${userId}`);
      expect(kv.set).toHaveBeenCalledWith(
        `cards:user:${userId}`,
        expect.objectContaining({
          fragments: 100 - exchangePrice,
          inventory: expect.arrayContaining([cardId]),
        })
      );
    });

    it('should fail if card ID is invalid', async () => {
      const result = await exchangeFragmentsForCard(userId, 'invalid-card');
      expect(result.success).toBe(false);
      expect(result.message).toBe('无效的卡片 ID');
    });

    it('should fail if fragments are insufficient', async () => {
      const cardId = 'animal-s1-legendary-小熊猫';
      // D1-compatible: kv.get returns user data with insufficient fragments
      const exchangePrice = EXCHANGE_PRICES.legendary;
      mockKvGet.mockResolvedValue({ inventory: [], fragments: exchangePrice - 1, pityCounter: 0, drawsAvailable: 1, collectionRewards: {} });

      const result = await exchangeFragmentsForCard(userId, cardId);

      expect(result.success).toBe(false);
      expect(result.message).toBe('碎片不足');
    });

    it('should fail without deducting when card is already owned', async () => {
      const cardId = 'animal-s1-rare-柴犬';
      // D1-compatible: kv.get returns user data with the card already in inventory
      mockKvGet.mockResolvedValue({ inventory: [cardId], fragments: 120, pityCounter: 0, drawsAvailable: 1, collectionRewards: {} });

      const result = await exchangeFragmentsForCard(userId, cardId);

      expect(result.success).toBe(false);
      expect(result.message).toBe('已拥有该卡片，无需兑换');
    });
  });
});
