import { describe, expect, it } from "vitest";
import { CARDS, ALBUMS, getCardsByAlbum } from "../config";
import { RARITY_PROBABILITIES, FRAGMENT_VALUES, EXCHANGE_PRICES, PITY_THRESHOLDS, RARITY_CARD_BACKS } from "../constants";
import type { Rarity } from "../types";

// Expected counts per album
const ALBUM_S1_COUNTS: Record<Rarity, number> = {
  common: 5,
  rare: 5,
  epic: 5,
  legendary: 3,
  legendary_rare: 2,
};

const ALBUM_S2_COUNTS: Record<Rarity, number> = {
  common: 16,
  rare: 12,
  epic: 5,
  legendary: 3,
  legendary_rare: 3,
};

describe("card configuration", () => {
  it("defines cards for all albums", () => {
    expect(ALBUMS.length).toBe(2);
    expect(CARDS.length).toBe(59); // 20 (S1) + 39 (S2)
  });

  it("assigns the expected number of cards per rarity for each album", () => {
    // Check Album S1
    const s1Cards = getCardsByAlbum("animal-s1");
    const s1Counts: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0, legendary_rare: 0 };
    s1Cards.forEach(card => { s1Counts[card.rarity]++; });
    for (const rarity of Object.keys(ALBUM_S1_COUNTS) as Rarity[]) {
      expect(s1Counts[rarity]).toBe(ALBUM_S1_COUNTS[rarity]);
    }

    // Check Album S2
    const s2Cards = getCardsByAlbum("animal-s2");
    const s2Counts: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0, legendary_rare: 0 };
    s2Cards.forEach(card => { s2Counts[card.rarity]++; });
    for (const rarity of Object.keys(ALBUM_S2_COUNTS) as Rarity[]) {
      expect(s2Counts[rarity]).toBe(ALBUM_S2_COUNTS[rarity]);
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
