import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCardsByRarity,
  countOwnedByRarity,
  isTierComplete,
  isAlbumComplete,
  getRewardKey,
  isRewardClaimed,
  getAlbumRewardStatuses,
} from "../rewards";
import { ALBUMS, getCardsByAlbum } from "../config";
import { COLLECTION_REWARDS } from "../constants";
import type { UserCards } from "../draw";

// Helper to create mock user data
function createMockUserData(inventory: string[] = [], claimedRewards: string[] = []): UserCards {
  return {
    inventory,
    fragments: 0,
    pityCounter: 0,
    drawsAvailable: 10,
    collectionRewards: claimedRewards,
  };
}

// Use the first album for testing
const testAlbumId = ALBUMS[0].id;

describe("Rewards System", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getCardsByRarity", () => {
    it("should return all common cards for album S1", () => {
      const commonCards = getCardsByRarity("common", testAlbumId);
      expect(commonCards.length).toBe(5);
      expect(commonCards.every(id => id.includes("-common-"))).toBe(true);
    });

    it("should return all rare cards for album S1", () => {
      const rareCards = getCardsByRarity("rare", testAlbumId);
      expect(rareCards.length).toBe(5);
      expect(rareCards.every(id => id.includes("-rare-"))).toBe(true);
    });

    it("should return all epic cards for album S1", () => {
      const epicCards = getCardsByRarity("epic", testAlbumId);
      expect(epicCards.length).toBe(5);
      expect(epicCards.every(id => id.includes("-epic-"))).toBe(true);
    });

    it("should return all legendary cards for album S1", () => {
      const legendaryCards = getCardsByRarity("legendary", testAlbumId);
      expect(legendaryCards.length).toBe(3);
      expect(legendaryCards.every(id => id.includes("-legendary-"))).toBe(true);
    });

    it("should return all legendary_rare cards for album S1", () => {
      const legendaryRareCards = getCardsByRarity("legendary_rare", testAlbumId);
      expect(legendaryRareCards.length).toBe(2);
      expect(legendaryRareCards.every(id => id.includes("-legendary_rare-"))).toBe(true);
    });

    it("should return cards from all albums when no albumId provided", () => {
      const commonCards = getCardsByRarity("common");
      expect(commonCards.length).toBe(47); // 5 (S1) + 16 (S2) + 26 (Tarot)
    });
  });

  describe("countOwnedByRarity", () => {
    it("should count 0 when inventory is empty", () => {
      expect(countOwnedByRarity([], "common")).toBe(0);
    });

    it("should count owned cards correctly", () => {
      const inventory = ["animal-s1-common-仓鼠", "animal-s1-common-河豚", "animal-s1-rare-柴犬"];
      expect(countOwnedByRarity(inventory, "common")).toBe(2);
      expect(countOwnedByRarity(inventory, "rare")).toBe(1);
      expect(countOwnedByRarity(inventory, "epic")).toBe(0);
    });

    it("should not double count duplicates", () => {
      const inventory = ["animal-s1-common-仓鼠", "animal-s1-common-仓鼠", "animal-s1-common-仓鼠"];
      expect(countOwnedByRarity(inventory, "common")).toBe(1);
    });
  });

  describe("isTierComplete", () => {
    it("should return false for empty inventory", () => {
      expect(isTierComplete([], "common")).toBe(false);
    });

    it("should return false for incomplete tier", () => {
      const inventory = ["animal-s1-common-仓鼠", "animal-s1-common-河豚"];
      expect(isTierComplete(inventory, "common")).toBe(false);
    });

    it("should return true for complete common tier", () => {
      const commonCards = getCardsByRarity("common");
      expect(isTierComplete(commonCards, "common")).toBe(true);
    });

    it("should return true for complete legendary_rare tier", () => {
      const legendaryRareCards = getCardsByRarity("legendary_rare");
      expect(isTierComplete(legendaryRareCards, "legendary_rare")).toBe(true);
    });
  });

  describe("isAlbumComplete", () => {
    it("should return false for empty inventory", () => {
      expect(isAlbumComplete([], testAlbumId)).toBe(false);
    });

    it("should return false for partial collection", () => {
      const inventory = getCardsByRarity("common");
      expect(isAlbumComplete(inventory, testAlbumId)).toBe(false);
    });

    it("should return true for full collection", () => {
      const allCards = getCardsByAlbum(testAlbumId).map(c => c.id);
      expect(isAlbumComplete(allCards, testAlbumId)).toBe(true);
    });
  });

  describe("getRewardKey", () => {
    it("should generate correct key for tier rewards without album", () => {
      expect(getRewardKey("common")).toBe("collection:common");
      expect(getRewardKey("legendary_rare")).toBe("collection:legendary_rare");
    });

    it("should generate correct key for tier rewards with album", () => {
      expect(getRewardKey("common", testAlbumId)).toBe(`album:${testAlbumId}:common`);
      expect(getRewardKey("legendary_rare", testAlbumId)).toBe(`album:${testAlbumId}:legendary_rare`);
    });

    it("should generate correct key for full set", () => {
      expect(getRewardKey("full_set")).toBe("collection:full_set");
      expect(getRewardKey("full_set", testAlbumId)).toBe(`album:${testAlbumId}:full_set`);
    });
  });

  describe("isRewardClaimed", () => {
    it("should return false when no rewards claimed", () => {
      const userData = createMockUserData();
      expect(isRewardClaimed(userData, "common", testAlbumId)).toBe(false);
    });

    it("should return true when reward is claimed", () => {
      const userData = createMockUserData([], [`album:${testAlbumId}:common`]);
      expect(isRewardClaimed(userData, "common", testAlbumId)).toBe(true);
    });

    it("should return false for unclaimed reward when others are claimed", () => {
      const userData = createMockUserData([], [`album:${testAlbumId}:common`, `album:${testAlbumId}:rare`]);
      expect(isRewardClaimed(userData, "epic", testAlbumId)).toBe(false);
    });
  });

  describe("getAlbumRewardStatuses", () => {
    it("should return all 6 reward statuses for album", async () => {
      const userData = createMockUserData();
      const statuses = await getAlbumRewardStatuses(userData, testAlbumId);
      expect(statuses.length).toBe(6);
    });

    it("should show correct points for each tier", async () => {
      const userData = createMockUserData();
      const statuses = await getAlbumRewardStatuses(userData, testAlbumId);

      const commonStatus = statuses.find((s: { type: string }) => s.type === "common");
      expect(commonStatus?.points).toBe(COLLECTION_REWARDS.common);

      const fullSetStatus = statuses.find((s: { type: string }) => s.type === "full_set");
      // full_set uses dynamic reward from config (default 10000 for animal-s1)
      expect(fullSetStatus?.points).toBe(10000);
    });

    it("should show eligible when tier is complete", async () => {
      const commonCards = getCardsByRarity("common", testAlbumId);
      const userData = createMockUserData(commonCards);
      const statuses = await getAlbumRewardStatuses(userData, testAlbumId);

      const commonStatus = statuses.find((s: { type: string }) => s.type === "common");
      expect(commonStatus?.eligible).toBe(true);
      expect(commonStatus?.claimed).toBe(false);
    });

    it("should show claimed when reward was claimed", async () => {
      const commonCards = getCardsByRarity("common", testAlbumId);
      const userData = createMockUserData(commonCards, [`album:${testAlbumId}:common`]);
      const statuses = await getAlbumRewardStatuses(userData, testAlbumId);

      const commonStatus = statuses.find((s: { type: string }) => s.type === "common");
      expect(commonStatus?.claimed).toBe(true);
    });

    it("should track owned/total counts correctly", async () => {
      const inventory = ["animal-s1-common-仓鼠", "animal-s1-common-河豚"];
      const userData = createMockUserData(inventory);
      const statuses = await getAlbumRewardStatuses(userData, testAlbumId);

      const commonStatus = statuses.find((s: { type: string }) => s.type === "common");
      expect(commonStatus?.ownedCount).toBe(2);
      expect(commonStatus?.totalCount).toBe(5);
    });
  });

  describe("Reward Point Values", () => {
    it("should have correct tier reward values", () => {
      expect(COLLECTION_REWARDS.common).toBe(400);
      expect(COLLECTION_REWARDS.rare).toBe(650);
      expect(COLLECTION_REWARDS.epic).toBe(1200);
      expect(COLLECTION_REWARDS.legendary).toBe(1800);
      expect(COLLECTION_REWARDS.legendary_rare).toBe(3500);
    });

    it("should have correct full set reward value", () => {
      expect(COLLECTION_REWARDS.full_set).toBe(10000);
    });
  });
});
