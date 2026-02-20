import { describe, it, expect, vi, beforeEach } from "vitest";
import { drawCard, UserCards } from "../draw";
import { kv } from "@/lib/d1-kv";
import { RARITY_LEVELS } from "../constants";

vi.mock("@/lib/d1-kv", () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

describe("drawCard with Pity System", () => {
  const userId = "test-user";
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);

  const getBaseUserData = (overrides: Partial<UserCards> = {}): UserCards => ({
    inventory: [],
    fragments: 0,
    pityCounter: 0,
    pityRare: 0,
    pityEpic: 0,
    pityLegendary: 0,
    pityLegendaryRare: 0,
    drawsAvailable: 1,
    collectionRewards: [],
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvSet.mockResolvedValue("OK");
  });

  it("should increment pity counter on normal draw", async () => {
    // Phase 1: reserveDraw reads user data with all pity at 0
    mockKvGet.mockResolvedValueOnce(getBaseUserData());
    // Phase 2: finalizeDraw reads user data (after pity incremented by reserveDraw)
    mockKvGet.mockResolvedValueOnce(
      getBaseUserData({
        drawsAvailable: 0,
        pityRare: 1,
        pityEpic: 1,
        pityLegendary: 1,
        pityLegendaryRare: 1,
        pityCounter: 1,
      })
    );

    const result = await drawCard(userId);
    expect(result.success).toBe(true);
    expect(result.card).toBeDefined();
  });

  it("should trigger rare pity on 10th draw", async () => {
    // Phase 1: reserveDraw reads data with pityRare=9
    // After reserveDraw increments, pityRare becomes 10 -> triggers rare pity
    mockKvGet.mockResolvedValueOnce(
      getBaseUserData({ pityRare: 9 })
    );
    // Phase 2: finalizeDraw reads data (pityRare=10 after increment)
    mockKvGet.mockResolvedValueOnce(
      getBaseUserData({
        drawsAvailable: 0,
        pityRare: 10,
        pityEpic: 1,
        pityLegendary: 1,
        pityLegendaryRare: 1,
        pityCounter: 1,
      })
    );

    const result = await drawCard(userId);
    expect(result.success).toBe(true);
    expect(RARITY_LEVELS[result.card!.rarity]).toBeGreaterThanOrEqual(RARITY_LEVELS.rare);
  });

  it("should trigger epic pity on 50th draw", async () => {
    // Phase 1: reserveDraw reads data with pityEpic=49
    // After reserveDraw increments, pityEpic becomes 50 -> triggers epic pity
    mockKvGet.mockResolvedValueOnce(
      getBaseUserData({ pityEpic: 49 })
    );
    // Phase 2: finalizeDraw reads data (pityEpic=50 after increment)
    mockKvGet.mockResolvedValueOnce(
      getBaseUserData({
        drawsAvailable: 0,
        pityRare: 1,
        pityEpic: 50,
        pityLegendary: 1,
        pityLegendaryRare: 1,
        pityCounter: 1,
      })
    );

    const result = await drawCard(userId);
    expect(result.success).toBe(true);
    expect(RARITY_LEVELS[result.card!.rarity]).toBeGreaterThanOrEqual(RARITY_LEVELS.epic);
  });

  it("should trigger legendary pity on 100th draw", async () => {
    // Phase 1: reserveDraw reads data with pityLegendary=99
    // After reserveDraw increments, pityLegendary becomes 100 -> triggers legendary pity
    mockKvGet.mockResolvedValueOnce(
      getBaseUserData({ pityLegendary: 99 })
    );
    // Phase 2: finalizeDraw reads data (pityLegendary=100 after increment)
    mockKvGet.mockResolvedValueOnce(
      getBaseUserData({
        drawsAvailable: 0,
        pityRare: 1,
        pityEpic: 1,
        pityLegendary: 100,
        pityLegendaryRare: 1,
        pityCounter: 1,
      })
    );

    const result = await drawCard(userId);
    expect(result.success).toBe(true);
    expect(RARITY_LEVELS[result.card!.rarity]).toBeGreaterThanOrEqual(RARITY_LEVELS.legendary);
  });

  it("should trigger legendary_rare pity on 200th draw", async () => {
    // Phase 1: reserveDraw reads data with pityLegendaryRare=199
    // After reserveDraw increments, pityLegendaryRare becomes 200 -> triggers legendary_rare pity
    mockKvGet.mockResolvedValueOnce(
      getBaseUserData({ pityLegendaryRare: 199 })
    );
    // Phase 2: finalizeDraw reads data (pityLegendaryRare=200 after increment)
    mockKvGet.mockResolvedValueOnce(
      getBaseUserData({
        drawsAvailable: 0,
        pityRare: 1,
        pityEpic: 1,
        pityLegendary: 1,
        pityLegendaryRare: 200,
        pityCounter: 200,
      })
    );

    const result = await drawCard(userId);
    expect(result.success).toBe(true);
    expect(result.card!.rarity).toBe("legendary_rare");
  });
});
