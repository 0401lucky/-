import { Rarity } from "./types";
import { PITY_THRESHOLDS } from "./constants";

/**
 * Check if pity should trigger based on current counter.
 */
export function checkPityTrigger(pityCounter: number): boolean {
  return (
    pityCounter === PITY_THRESHOLDS.rare ||
    pityCounter === PITY_THRESHOLDS.epic ||
    pityCounter === PITY_THRESHOLDS.legendary ||
    pityCounter === PITY_THRESHOLDS.legendary_rare
  );
}

/**
 * Get the guaranteed rarity level for the current pity counter.
 */
export function getGuaranteedRarity(pityCounter: number): Rarity | null {
  if (pityCounter === PITY_THRESHOLDS.legendary_rare) return "legendary_rare";
  if (pityCounter === PITY_THRESHOLDS.legendary) return "legendary";
  if (pityCounter === PITY_THRESHOLDS.epic) return "epic";
  if (pityCounter === PITY_THRESHOLDS.rare) return "rare";
  return null;
}

/**
 * Determine if the pity counter should be reset.
 * Resets only when the TOP rarity is obtained (naturally or via pity),
 * so the counter can progress through all milestones (10/50/100/200)
 * and the UI can display higher-tier pity statuses.
 */
export function shouldResetPity(pityCounter: number, drawnRarity: Rarity): boolean {
  // Reset on top rarity
  if (drawnRarity === "legendary_rare") {
    return true;
  }

  // Defensive: if counter reaches/overflows the hard pity threshold, reset
  if (pityCounter >= PITY_THRESHOLDS.legendary_rare) {
    return true;
  }

  return false;
}
