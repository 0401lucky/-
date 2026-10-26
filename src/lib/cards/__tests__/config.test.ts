import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
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

const ALBUM_PERSONA_COUNTS: Record<Rarity, number> = {
  common: 9,
  rare: 7,
  epic: 5,
  legendary: 3,
  legendary_rare: 2,
};

const ALBUM_HOK_MODERN_COUNTS: Record<Rarity, number> = {
  common: 44,
  rare: 32,
  epic: 24,
  legendary: 18,
  legendary_rare: 10,
};

describe("card configuration", () => {
  it("defines cards for all albums", () => {
    expect(ALBUMS.length).toBe(5);
    expect(CARDS.length).toBe(291); // 20 + 39 + 78 + 26 + 128 (HOK Modern)
    expect(new Set(CARDS.map(card => card.id)).size).toBe(CARDS.length);
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

    // Check Persona Album S1
    const personaCards = getCardsByAlbum("persona-s1");
    const personaCounts: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0, legendary_rare: 0 };
    personaCards.forEach(card => { personaCounts[card.rarity]++; });
    for (const rarity of Object.keys(ALBUM_PERSONA_COUNTS) as Rarity[]) {
      expect(personaCounts[rarity]).toBe(ALBUM_PERSONA_COUNTS[rarity]);
    }

    const hokCards = getCardsByAlbum("hok-modern-s1");
    expect(hokCards).toHaveLength(128);
    expect(new Set(hokCards.map(card => card.name)).size).toBe(128);
    for (const rarity of Object.keys(ALBUM_HOK_MODERN_COUNTS) as Rarity[]) {
      expect(hokCards.filter(card => card.rarity === rarity)).toHaveLength(ALBUM_HOK_MODERN_COUNTS[rarity]);
    }
  });

  it("places the ten selected heroes in the highest rarity", () => {
    const names = getCardsByAlbum("hok-modern-s1")
      .filter(card => card.rarity === "legendary_rare")
      .map(card => card.name);
    expect(names).toEqual(["甄姬", "张良", "西施", "艾琳", "嫦娥", "王维", "朵莉亚", "李白", "少司缘", "杨戬"]);
  });

  it("defines the HOK full-set and tier rewards", () => {
    const album = ALBUMS.find(album => album.id === "hok-modern-s1");
    expect(album?.reward).toBe(22000);
    expect(album?.tierRewards).toEqual({ common: 800, rare: 1400, epic: 2400, legendary: 4000, legendary_rare: 7000 });
    expect(album?.coverImage).toBe("/images-optimized/thumb/王者现代/传说稀有/甄姬.webp");
  });

  it("ships all HOK originals and optimized assets", () => {
    const publicDirectory = resolve(process.cwd(), "public");
    for (const card of getCardsByAlbum("hok-modern-s1")) {
      for (const asset of [card.originalImage, card.image, card.thumbnailImage]) {
        expect(asset).toBeTruthy();
        expect(existsSync(join(publicDirectory, asset!.slice(1))), asset).toBe(true);
      }
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
