import { describe, it, expect } from "vitest";
import {
  getCardsByRarity,
  countOwnedByRarity,
  isTierComplete,
  isFullCollectionComplete,
  getRewardKey,
  isRewardClaimed,
  getRewardStatuses,
} from "../rewards";
import { CARDS } from "../config";
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

describe("Rewards System", () => {
  describe("getCardsByRarity", () => {
    it("should return all common cards", () => {
      const commonCards = getCardsByRarity("common");
      expect(commonCards.length).toBe(5);
      expect(commonCards.every(id => id.startsWith("common-"))).toBe(true);
    });

    it("should return all rare cards", () => {
      const rareCards = getCardsByRarity("rare");
      expect(rareCards.length).toBe(5);
      expect(rareCards.every(id => id.startsWith("rare-"))).toBe(true);
    });

    it("should return all epic cards", () => {
      const epicCards = getCardsByRarity("epic");
      expect(epicCards.length).toBe(5);
      expect(epicCards.every(id => id.startsWith("epic-"))).toBe(true);
    });

    it("should return all legendary cards", () => {
      const legendaryCards = getCardsByRarity("legendary");
      expect(legendaryCards.length).toBe(3);
      expect(legendaryCards.every(id => id.startsWith("legendary-"))).toBe(true);
    });

    it("should return all legendary_rare cards", () => {
      const legendaryRareCards = getCardsByRarity("legendary_rare");
      expect(legendaryRareCards.length).toBe(2);
      expect(legendaryRareCards.every(id => id.startsWith("legendary_rare-"))).toBe(true);
    });
  });

  describe("countOwnedByRarity", () => {
    it("should count 0 when inventory is empty", () => {
      expect(countOwnedByRarity([], "common")).toBe(0);
    });

    it("should count owned cards correctly", () => {
      const inventory = ["common-仓鼠", "common-河豚", "rare-柴犬"];
      expect(countOwnedByRarity(inventory, "common")).toBe(2);
      expect(countOwnedByRarity(inventory, "rare")).toBe(1);
      expect(countOwnedByRarity(inventory, "epic")).toBe(0);
    });

    it("should not double count duplicates", () => {
      const inventory = ["common-仓鼠", "common-仓鼠", "common-仓鼠"];
      expect(countOwnedByRarity(inventory, "common")).toBe(1);
    });
  });

  describe("isTierComplete", () => {
    it("should return false for empty inventory", () => {
      expect(isTierComplete([], "common")).toBe(false);
    });

    it("should return false for incomplete tier", () => {
      const inventory = ["common-仓鼠", "common-河豚"];
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

  describe("isFullCollectionComplete", () => {
    it("should return false for empty inventory", () => {
      expect(isFullCollectionComplete([])).toBe(false);
    });

    it("should return false for partial collection", () => {
      const inventory = getCardsByRarity("common");
      expect(isFullCollectionComplete(inventory)).toBe(false);
    });

    it("should return true for full collection", () => {
      const allCards = CARDS.map(c => c.id);
      expect(isFullCollectionComplete(allCards)).toBe(true);
    });
  });

  describe("getRewardKey", () => {
    it("should generate correct key for tier rewards", () => {
      expect(getRewardKey("common")).toBe("collection:common");
      expect(getRewardKey("legendary_rare")).toBe("collection:legendary_rare");
    });

    it("should generate correct key for full set", () => {
      expect(getRewardKey("full_set")).toBe("collection:full_set");
    });
  });

  describe("isRewardClaimed", () => {
    it("should return false when no rewards claimed", () => {
      const userData = createMockUserData();
      expect(isRewardClaimed(userData, "common")).toBe(false);
    });

    it("should return true when reward is claimed", () => {
      const userData = createMockUserData([], ["collection:common"]);
      expect(isRewardClaimed(userData, "common")).toBe(true);
    });

    it("should return false for unclaimed reward when others are claimed", () => {
      const userData = createMockUserData([], ["collection:common", "collection:rare"]);
      expect(isRewardClaimed(userData, "epic")).toBe(false);
    });
  });

  describe("getRewardStatuses", () => {
    it("should return all 6 reward statuses", () => {
      const userData = createMockUserData();
      const statuses = getRewardStatuses(userData);
      expect(statuses.length).toBe(6);
    });

    it("should show correct points for each tier", () => {
      const userData = createMockUserData();
      const statuses = getRewardStatuses(userData);
      
      const commonStatus = statuses.find(s => s.type === "common");
      expect(commonStatus?.points).toBe(COLLECTION_REWARDS.common);
      
      const fullSetStatus = statuses.find(s => s.type === "full_set");
      expect(fullSetStatus?.points).toBe(COLLECTION_REWARDS.full_set);
    });

    it("should show eligible when tier is complete", () => {
      const commonCards = getCardsByRarity("common");
      const userData = createMockUserData(commonCards);
      const statuses = getRewardStatuses(userData);
      
      const commonStatus = statuses.find(s => s.type === "common");
      expect(commonStatus?.eligible).toBe(true);
      expect(commonStatus?.claimed).toBe(false);
    });

    it("should show claimed when reward was claimed", () => {
      const commonCards = getCardsByRarity("common");
      const userData = createMockUserData(commonCards, ["collection:common"]);
      const statuses = getRewardStatuses(userData);
      
      const commonStatus = statuses.find(s => s.type === "common");
      expect(commonStatus?.claimed).toBe(true);
    });

    it("should track owned/total counts correctly", () => {
      const inventory = ["common-仓鼠", "common-河豚"];
      const userData = createMockUserData(inventory);
      const statuses = getRewardStatuses(userData);
      
      const commonStatus = statuses.find(s => s.type === "common");
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
