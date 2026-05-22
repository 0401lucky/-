import { kv } from '@/lib/d1-kv';
import type { Rarity } from './types';
import {
  CARD_DRAW_PRICE,
  EXCHANGE_PRICES,
  FRAGMENT_VALUES,
  PITY_THRESHOLDS,
  RARITY_PROBABILITIES,
} from './constants';

export type PityThresholdsConfig = Record<'rare' | 'epic' | 'legendary' | 'legendary_rare', number>;

export interface CardRulesConfig {
  rarityProbabilities: Record<Rarity, number>;
  pityThresholds: PityThresholdsConfig;
  cardDrawPrice: number;
  fragmentValues: Record<Rarity, number>;
  exchangePrices: Record<Rarity, number>;
  updatedAt: number;
}

const CARD_RULES_KEY = 'cards:rules:config';
const RARITIES: Rarity[] = ['legendary_rare', 'legendary', 'epic', 'rare', 'common'];

export function getDefaultCardRulesConfig(): CardRulesConfig {
  return {
    rarityProbabilities: { ...RARITY_PROBABILITIES },
    pityThresholds: { ...PITY_THRESHOLDS },
    cardDrawPrice: CARD_DRAW_PRICE,
    fragmentValues: { ...FRAGMENT_VALUES },
    exchangePrices: { ...EXCHANGE_PRICES },
    updatedAt: 0,
  };
}

function safePositiveInt(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function safeNonNegativeNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

export function sanitizeCardRulesConfig(input?: Partial<CardRulesConfig> | null): CardRulesConfig {
  const fallback = getDefaultCardRulesConfig();

  const rarityProbabilities = {} as Record<Rarity, number>;
  const fragmentValues = {} as Record<Rarity, number>;
  const exchangePrices = {} as Record<Rarity, number>;

  for (const rarity of RARITIES) {
    rarityProbabilities[rarity] = safeNonNegativeNumber(
      input?.rarityProbabilities?.[rarity],
      fallback.rarityProbabilities[rarity],
    );
    fragmentValues[rarity] = safePositiveInt(input?.fragmentValues?.[rarity], fallback.fragmentValues[rarity]);
    exchangePrices[rarity] = safePositiveInt(input?.exchangePrices?.[rarity], fallback.exchangePrices[rarity]);
  }

  return {
    rarityProbabilities,
    pityThresholds: {
      rare: safePositiveInt(input?.pityThresholds?.rare, fallback.pityThresholds.rare),
      epic: safePositiveInt(input?.pityThresholds?.epic, fallback.pityThresholds.epic),
      legendary: safePositiveInt(input?.pityThresholds?.legendary, fallback.pityThresholds.legendary),
      legendary_rare: safePositiveInt(input?.pityThresholds?.legendary_rare, fallback.pityThresholds.legendary_rare),
    },
    cardDrawPrice: safePositiveInt(input?.cardDrawPrice, fallback.cardDrawPrice),
    fragmentValues,
    exchangePrices,
    updatedAt: typeof input?.updatedAt === 'number' ? input.updatedAt : fallback.updatedAt,
  };
}

export async function getCardRulesConfig(): Promise<CardRulesConfig> {
  const saved = await kv.get<Partial<CardRulesConfig>>(CARD_RULES_KEY);
  if (!saved) {
    const defaults = getDefaultCardRulesConfig();
    await kv.set(CARD_RULES_KEY, defaults);
    return defaults;
  }
  return sanitizeCardRulesConfig(saved);
}

export async function updateCardRulesConfig(input: Partial<CardRulesConfig>): Promise<CardRulesConfig> {
  const next = sanitizeCardRulesConfig({
    ...(await getCardRulesConfig()),
    ...input,
    updatedAt: Date.now(),
  });

  const totalProbability = Object.values(next.rarityProbabilities).reduce((sum, value) => sum + value, 0);
  if (Math.abs(totalProbability - 100) > 0.01) {
    throw new Error(`稀有度概率合计必须为100%，当前为${totalProbability.toFixed(2)}%`);
  }

  await kv.set(CARD_RULES_KEY, next);
  return next;
}
