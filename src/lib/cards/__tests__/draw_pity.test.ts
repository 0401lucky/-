import { describe, it, expect, vi, beforeEach } from "vitest";
import { drawCard } from "../draw";
import { kv } from "@vercel/kv";
import { RARITY_LEVELS } from "../constants";

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    eval: vi.fn(),
  },
}));

describe("drawCard with Pity System", () => {
  const userId = "test-user";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should increment pity counter on normal draw", async () => {
    // Mock kv.eval for two-phase draw:
    // Phase 1 (RESERVE_DRAW_SCRIPT): returns [success, pityCounter, status]
    // Phase 2 (FINALIZE_DRAW_SCRIPT): returns [success, status, fragmentsAdded]
    (kv.eval as any)
      .mockResolvedValueOnce([1, 1, "ok"]) // Reserve: success, pityCounter=1
      .mockResolvedValueOnce([1, "ok", 0]); // Finalize: success, not duplicate

    const result = await drawCard(userId);
    expect(result.success).toBe(true);
    expect(result.card).toBeDefined();
  });

  it("should trigger rare pity on 10th draw", async () => {
    // Phase 1: pityCounter becomes 10 (triggers rare pity)
    // Phase 2: card added successfully
    (kv.eval as any)
      .mockResolvedValueOnce([1, 10, "ok"])
      .mockResolvedValueOnce([1, "ok", 0]);

    const result = await drawCard(userId);
    expect(result.success).toBe(true);
    expect(RARITY_LEVELS[result.card!.rarity]).toBeGreaterThanOrEqual(RARITY_LEVELS.rare);
  });

  it("should trigger epic pity on 50th draw", async () => {
    // Phase 1: pityCounter becomes 50 (triggers epic pity)
    // Phase 2: card added successfully
    (kv.eval as any)
      .mockResolvedValueOnce([1, 50, "ok"])
      .mockResolvedValueOnce([1, "ok", 0]);

    const result = await drawCard(userId);
    expect(result.success).toBe(true);
    expect(RARITY_LEVELS[result.card!.rarity]).toBeGreaterThanOrEqual(RARITY_LEVELS.epic);
  });

  it("should trigger legendary pity on 100th draw", async () => {
    // Phase 1: pityCounter becomes 100 (triggers legendary pity)
    // Phase 2: card added successfully
    (kv.eval as any)
      .mockResolvedValueOnce([1, 100, "ok"])
      .mockResolvedValueOnce([1, "ok", 0]);

    const result = await drawCard(userId);
    expect(result.success).toBe(true);
    expect(RARITY_LEVELS[result.card!.rarity]).toBeGreaterThanOrEqual(RARITY_LEVELS.legendary);
  });

  it("should trigger legendary_rare pity on 200th draw", async () => {
    // Phase 1: pityCounter becomes 200 (triggers legendary_rare pity)
    // Phase 2: card added successfully
    (kv.eval as any)
      .mockResolvedValueOnce([1, 200, "ok"])
      .mockResolvedValueOnce([1, "ok", 0]);

    const result = await drawCard(userId);
    expect(result.success).toBe(true);
    expect(result.card!.rarity).toBe("legendary_rare");
  });
});
