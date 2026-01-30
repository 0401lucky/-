import { describe, it, expect } from "vitest";
import { checkPityTrigger, getGuaranteedRarity, shouldResetPity } from "../pity";

describe("Pity System", () => {
  describe("checkPityTrigger", () => {
    it("should trigger pity at 10 draws", () => {
      expect(checkPityTrigger(10)).toBe(true);
    });

    it("should trigger pity at 50 draws", () => {
      expect(checkPityTrigger(50)).toBe(true);
    });

    it("should trigger pity at 100 draws", () => {
      expect(checkPityTrigger(100)).toBe(true);
    });

    it("should trigger pity at 200 draws", () => {
      expect(checkPityTrigger(200)).toBe(true);
    });

    it("should not trigger pity at 9 draws", () => {
      expect(checkPityTrigger(9)).toBe(false);
    });

    it("should not trigger pity at 0 draws", () => {
      expect(checkPityTrigger(0)).toBe(false);
    });
  });

  describe("getGuaranteedRarity", () => {
    it("should guarantee rare at 10 draws", () => {
      expect(getGuaranteedRarity(10)).toBe("rare");
    });

    it("should guarantee epic at 50 draws", () => {
      expect(getGuaranteedRarity(50)).toBe("epic");
    });

    it("should guarantee legendary at 100 draws", () => {
      expect(getGuaranteedRarity(100)).toBe("legendary");
    });

    it("should guarantee legendary_rare at 200 draws", () => {
      expect(getGuaranteedRarity(200)).toBe("legendary_rare");
    });
    
    it("should return null if no guarantee", () => {
      expect(getGuaranteedRarity(9)).toBe(null);
    });
  });

  describe("shouldResetPity", () => {
    it("should reset if rarity drawn is legendary_rare regardless of counter", () => {
      expect(shouldResetPity(5, "legendary_rare")).toBe(true);
    });

    it("should NOT reset if pity triggered at 10 draws (rare guarantee)", () => {
      expect(shouldResetPity(10, "rare")).toBe(false);
      expect(shouldResetPity(10, "epic")).toBe(false);
    });

    it("should NOT reset if common is drawn on 1st draw", () => {
      expect(shouldResetPity(1, "common")).toBe(false);
    });
    
    it("should NOT reset if rare is drawn on 5th draw (as it's not a trigger and not legendary+)", () => {
      expect(shouldResetPity(5, "rare")).toBe(false);
    });

    it("should NOT reset if legendary is drawn (counter keeps progressing toward legendary_rare)", () => {
      expect(shouldResetPity(5, "legendary")).toBe(false);
      expect(shouldResetPity(100, "legendary")).toBe(false);
    });
  });
});
