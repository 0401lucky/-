import { describe, expect, it } from "bun:test";
import { CARDS } from "../config";
import { RARITY_PROBABILITIES, FRAGMENT_VALUES, EXCHANGE_PRICES, PITY_THRESHOLDS, RARITY_CARD_BACKS } from "../constants";
import type { Rarity } from "../types";

const EXPECTED_RARITY_COUNTS: Record<Rarity, number> = {
  common: 5,
  rare: 5,
  epic: 5,
  legendary: 3,
  legendary_rare: 2,
};

describe("card configuration", () => {
  it("defines exactly 20 cards", () => {
    expect(CARDS.length).toBe(20);
  });

  it("assigns the expected number of cards per rarity", () => {
    const counts: Record<Rarity, number> = {
      common: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
      legendary_rare: 0,
    };

    CARDS.forEach(card => {
      counts[card.rarity]++;
    });

    for (const rarity of Object.keys(EXPECTED_RARITY_COUNTS) as Rarity[]) {
      expect(counts[rarity]).toBe(EXPECTED_RARITY_COUNTS[rarity]);
    }
  });

  it("ensures all cards have valid fields", () => {
    CARDS.forEach(card => {
      expect(card.id).toBeTruthy();
      expect(card.name).toBeTruthy();
      expect(card.rarity).toBeTruthy();
      expect(card.image).toContain(card.name);
      expect(card.backImage).toBe(RARITY_CARD_BACKS[card.rarity]);
      expect(card.probability).toBeGreaterThan(0);
    });
  });

  it("sets fragment and exchange constants for every rarity", () => {
    const rarities: Rarity[] = [
      "common",
      "rare",
      "epic",
      "legendary",
      "legendary_rare",
    ];

    for (const rarity of rarities) {
      expect(FRAGMENT_VALUES[rarity]).toBeGreaterThan(0);
      expect(EXCHANGE_PRICES[rarity]).toBeGreaterThan(0);
    }
  });

  it("defines pity thresholds starting from rare rarity", () => {
    const pityRarities: (keyof typeof PITY_THRESHOLDS)[] = ["rare", "epic", "legendary", "legendary_rare"];

    for (const rarity of pityRarities) {
      expect(PITY_THRESHOLDS[rarity]).toBeGreaterThan(0);
    }
  });

  it("defines rarity probability weights that sum to 100%", () => {
    const totalProbability = Object.values(RARITY_PROBABILITIES).reduce((sum, value) => sum + value, 0);
    expect(totalProbability).toBe(100);
  });
});
