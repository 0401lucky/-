import { Rarity } from "./types";
import { PITY_THRESHOLDS } from "./constants";

/**
 * Per-tier pity counters.
 * Each counter represents "draws since last obtaining this rarity (or higher)".
 */
export interface PityCounters {
  rare: number;
  epic: number;
  legendary: number;
  legendary_rare: number;
}

/**
 * Normalize pity counters to safe non-negative integers.
 */
export function normalizePityCounters(input?: Partial<PityCounters> | null): PityCounters {
  const toSafeInt = (value: unknown) => {
    const raw = Number(value);
    return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  };

  return {
    rare: toSafeInt(input?.rare),
    epic: toSafeInt(input?.epic),
    legendary: toSafeInt(input?.legendary),
    legendary_rare: toSafeInt(input?.legendary_rare),
  };
}

/**
 * Get the guaranteed rarity level for the current counters.
 * Highest-tier guarantee takes precedence.
 */
export function getGuaranteedRarity(counters: PityCounters): Rarity | null {
  if (counters.legendary_rare >= PITY_THRESHOLDS.legendary_rare) return "legendary_rare";
  if (counters.legendary >= PITY_THRESHOLDS.legendary) return "legendary";
  if (counters.epic >= PITY_THRESHOLDS.epic) return "epic";
  if (counters.rare >= PITY_THRESHOLDS.rare) return "rare";
  return null;
}
