import { describe, it, expect } from "vitest";
import { getGuaranteedRarity, normalizePityCounters } from "../pity";

describe("Pity System", () => {
  describe("normalizePityCounters", () => {
    it("should coerce to non-negative integers", () => {
      // 使用类型断言测试运行时非法输入的处理
      expect(
        normalizePityCounters({
          rare: -1,
          epic: 1.9,
          legendary: "2" as unknown as number,
          legendary_rare: Number.NaN,
        })
      ).toEqual({ rare: 0, epic: 1, legendary: 2, legendary_rare: 0 });
    });
  });

  describe("getGuaranteedRarity", () => {
    it("should guarantee rare at 10 draws", () => {
      expect(getGuaranteedRarity({ rare: 10, epic: 0, legendary: 0, legendary_rare: 0 })).toBe("rare");
    });

    it("should guarantee epic at 50 draws", () => {
      expect(getGuaranteedRarity({ rare: 0, epic: 50, legendary: 0, legendary_rare: 0 })).toBe("epic");
    });

    it("should guarantee legendary at 100 draws", () => {
      expect(getGuaranteedRarity({ rare: 0, epic: 0, legendary: 100, legendary_rare: 0 })).toBe("legendary");
    });

    it("should guarantee legendary_rare at 200 draws", () => {
      expect(getGuaranteedRarity({ rare: 0, epic: 0, legendary: 0, legendary_rare: 200 })).toBe("legendary_rare");
    });

    it("should prefer higher-tier guarantee when multiple thresholds are met", () => {
      expect(getGuaranteedRarity({ rare: 10, epic: 50, legendary: 0, legendary_rare: 0 })).toBe("epic");
      expect(getGuaranteedRarity({ rare: 999, epic: 999, legendary: 100, legendary_rare: 0 })).toBe("legendary");
      expect(getGuaranteedRarity({ rare: 999, epic: 999, legendary: 999, legendary_rare: 200 })).toBe("legendary_rare");
    });

    it("should return null if no guarantee", () => {
      expect(getGuaranteedRarity({ rare: 9, epic: 49, legendary: 99, legendary_rare: 199 })).toBe(null);
    });
  });
});
