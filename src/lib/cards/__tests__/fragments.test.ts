import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDuplicateCard, exchangeFragmentsForCard, getFragmentValue, getExchangePrice } from '../fragments';
import { kv } from '@vercel/kv';
import { CARDS } from '../config';
import { FRAGMENT_VALUES, EXCHANGE_PRICES } from '../constants';

vi.mock('@vercel/kv', () => ({
  kv: {
    eval: vi.fn(),
  },
}));

describe('Card Fragment System', () => {
  const userId = 'user_123';

  beforeEach(() => {
    vi.clearAllMocks();
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
      // Lua script returns [isDuplicate, fragmentAmount]
      (kv.eval as any).mockResolvedValue([0, 0]);

      const result = await handleDuplicateCard(userId, cardId);

      expect(result.isDuplicate).toBe(false);
      expect(result.fragmentsAdded).toBe(0);
      expect(kv.eval).toHaveBeenCalled();
    });

    it('should convert to fragments if card is duplicate', async () => {
      const cardId = 'animal-s1-common-仓鼠';
      const fragmentValue = FRAGMENT_VALUES.common;
      (kv.eval as any).mockResolvedValue([1, fragmentValue]);

      const result = await handleDuplicateCard(userId, cardId);

      expect(result.isDuplicate).toBe(true);
      expect(result.fragmentsAdded).toBe(fragmentValue);
    });
  });

  describe('exchangeFragmentsForCard', () => {
    it('should exchange fragments for a card successfully', async () => {
      const cardId = 'animal-s1-rare-柴犬';
      const exchangePrice = EXCHANGE_PRICES.rare;
      // Lua script returns [success, newFragmentCount]
      (kv.eval as any).mockResolvedValue([1, 100 - exchangePrice]);

      const result = await exchangeFragmentsForCard(userId, cardId);

      expect(result.success).toBe(true);
      expect(kv.eval).toHaveBeenCalled();
    });

    it('should fail if card ID is invalid', async () => {
      const result = await exchangeFragmentsForCard(userId, 'invalid-card');
      expect(result.success).toBe(false);
      expect(result.message).toBe('无效的卡片 ID');
    });

    it('should fail if fragments are insufficient', async () => {
      const cardId = 'animal-s1-legendary-小熊猫';
      // Lua script returns [0, currentFragments, 'insufficient_fragments']
      (kv.eval as any).mockResolvedValue([0, 50, 'insufficient_fragments']);

      const result = await exchangeFragmentsForCard(userId, cardId);

      expect(result.success).toBe(false);
      expect(result.message).toBe('碎片不足');
    });
  });
});
