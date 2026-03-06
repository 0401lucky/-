import { kv } from '@/lib/d1-kv';
import { CARDS } from "./config";
import { CardConfig, Rarity } from "./types";
import { RARITY_PROBABILITIES, RARITY_LEVELS, FRAGMENT_VALUES } from "./constants";
import { getGuaranteedRarity, normalizePityCounters, type PityCounters } from "./pity";
import { secureRandomFloat, secureRandomIndex } from "../random";
import { withUserEconomyLock } from "../economy-lock";

export interface UserCards {
  inventory: string[];
  fragments: number;
  /**
   * Backward-compatible alias for `pityLegendaryRare`.
   * (Admin pages and older clients still reference `pityCounter`)
   */
  pityCounter: number;
  pityRare?: number;
  pityEpic?: number;
  pityLegendary?: number;
  pityLegendaryRare?: number;
  drawsAvailable: number;
  collectionRewards: string[];
}

const DEFAULT_USER_CARDS: UserCards = {
  inventory: [],
  fragments: 0,
  pityCounter: 0,
  pityRare: 0,
  pityEpic: 0,
  pityLegendary: 0,
  pityLegendaryRare: 0,
  drawsAvailable: 1,
  collectionRewards: [],
};

export function createDefaultUserCards(drawsAvailable: number = DEFAULT_USER_CARDS.drawsAvailable): UserCards {
  return {
    inventory: [],
    fragments: 0,
    pityCounter: 0,
    pityRare: 0,
    pityEpic: 0,
    pityLegendary: 0,
    pityLegendaryRare: 0,
    drawsAvailable,
    collectionRewards: [],
  };
}

export function normalizeUserCards(data: Partial<UserCards> | null | undefined): UserCards {
  const inventory = Array.isArray(data?.inventory)
    ? data.inventory.filter((id): id is string => typeof id === "string")
    : [];

  const fragmentsRaw = Number(data?.fragments);
  const fragments = Number.isFinite(fragmentsRaw) ? Math.max(0, Math.floor(fragmentsRaw)) : DEFAULT_USER_CARDS.fragments;

  const pityLegendaryRareRaw = Number(data?.pityLegendaryRare ?? data?.pityCounter);
  const pityLegendaryRare = Number.isFinite(pityLegendaryRareRaw)
    ? Math.max(0, Math.floor(pityLegendaryRareRaw))
    : (DEFAULT_USER_CARDS.pityLegendaryRare ?? 0);

  const pityRareRaw = Number(data?.pityRare);
  const pityRare = Number.isFinite(pityRareRaw) ? Math.max(0, Math.floor(pityRareRaw)) : (DEFAULT_USER_CARDS.pityRare ?? 0);

  const pityEpicRaw = Number(data?.pityEpic);
  const pityEpic = Number.isFinite(pityEpicRaw) ? Math.max(0, Math.floor(pityEpicRaw)) : (DEFAULT_USER_CARDS.pityEpic ?? 0);

  const pityLegendaryRaw = Number(data?.pityLegendary);
  const pityLegendary = Number.isFinite(pityLegendaryRaw)
    ? Math.max(0, Math.floor(pityLegendaryRaw))
    : (DEFAULT_USER_CARDS.pityLegendary ?? 0);

  const pityCounter = pityLegendaryRare;

  const drawsRaw = Number(data?.drawsAvailable);
  const drawsAvailable = Number.isFinite(drawsRaw)
    ? Math.max(0, Math.floor(drawsRaw))
    : DEFAULT_USER_CARDS.drawsAvailable;

  const collectionRewards = Array.isArray(data?.collectionRewards)
    ? data.collectionRewards.filter((id): id is string => typeof id === "string")
    : [];

  return {
    inventory,
    fragments,
    pityCounter,
    pityRare,
    pityEpic,
    pityLegendary,
    pityLegendaryRare,
    drawsAvailable,
    collectionRewards,
  };
}

export async function getUserCardData(userId: string): Promise<UserCards> {
  const data = await kv.get<UserCards>(`cards:user:${userId}`);
  return normalizeUserCards(data || null);
}

export async function updateUserCardData(userId: string, data: UserCards): Promise<void> {
  await kv.set(`cards:user:${userId}`, normalizeUserCards(data));
}

/**
 * Selects a card from a specific rarity.
 */
export function selectCardByRarity(rarity: Rarity): CardConfig {
  const cardsInRarity = CARDS.filter((c) => c.rarity === rarity);

  // Fallback if no cards in rarity (should not happen with correct config)
  if (cardsInRarity.length === 0) {
    return CARDS[CARDS.length - 1];
  }

  return cardsInRarity[secureRandomIndex(cardsInRarity.length)]!;
}

/**
 * Selects a card based on probability weights.
 * First selects a rarity tier based on RARITY_PROBABILITIES,
 * then selects a random card within that tier.
 */
export function selectCardByProbability(): CardConfig {
  const rarities = Object.keys(RARITY_PROBABILITIES) as Rarity[];
  const totalWeight = rarities.reduce((sum, r) => sum + RARITY_PROBABILITIES[r], 0);

  let random = secureRandomFloat() * totalWeight;
  let selectedRarity: Rarity = "common";

  for (const rarity of rarities) {
    random -= RARITY_PROBABILITIES[rarity];
    if (random <= 0) {
      selectedRarity = rarity;
      break;
    }
  }

  return selectCardByRarity(selectedRarity);
}

/**
 * Select card based on pity counter (after increment).
 */
function selectCardForDraw(counters: PityCounters): CardConfig {
  const guaranteed = getGuaranteedRarity(counters);
  if (!guaranteed) return selectCardByProbability();

  const minLevel = RARITY_LEVELS[guaranteed];
  const eligibleCards = CARDS.filter((c) => RARITY_LEVELS[c.rarity] >= minLevel);
  return eligibleCards[secureRandomIndex(eligibleCards.length)]!;
}

/**
 * Phase 1: Reserve draw.
 * Reads user data, checks drawsAvailable, decrements it, increments pity counters.
 */
async function reserveDraw(userKey: string): Promise<{
  success: boolean;
  pityCounters?: PityCounters;
  status: string;
}> {
  const data = await kv.get<UserCards>(userKey);
  const userData = normalizeUserCards(data);

  if (userData.drawsAvailable <= 0) {
    return { success: false, status: "no_draws" };
  }

  userData.drawsAvailable -= 1;
  userData.pityRare = (userData.pityRare ?? 0) + 1;
  userData.pityEpic = (userData.pityEpic ?? 0) + 1;
  userData.pityLegendary = (userData.pityLegendary ?? 0) + 1;
  userData.pityLegendaryRare = (userData.pityLegendaryRare ?? 0) + 1;
  userData.pityCounter = userData.pityLegendaryRare;

  await kv.set(userKey, userData);

  return {
    success: true,
    pityCounters: {
      rare: userData.pityRare,
      epic: userData.pityEpic,
      legendary: userData.pityLegendary,
      legendary_rare: userData.pityLegendaryRare,
    },
    status: "ok",
  };
}

/**
 * Phase 2: Finalize draw.
 * Adds card to inventory (or converts to fragments if duplicate), resets pity tiers.
 */
async function finalizeDraw(
  userKey: string,
  cardId: string,
  rarity: string,
  fragmentValue: number,
): Promise<{ success: boolean; status: string; fragmentsAdded: number }> {
  const data = await kv.get<UserCards>(userKey);
  const userData = normalizeUserCards(data);

  const isDuplicate = userData.inventory.includes(cardId);

  let fragmentsAdded = 0;
  if (isDuplicate) {
    userData.fragments += fragmentValue;
    fragmentsAdded = fragmentValue;
  } else {
    userData.inventory.push(cardId);
  }

  // Reset pity tiers based on drawn rarity (tiered cyclic pity)
  if (rarity === "legendary_rare") {
    userData.pityRare = 0;
    userData.pityEpic = 0;
    userData.pityLegendary = 0;
    userData.pityLegendaryRare = 0;
  } else if (rarity === "legendary") {
    userData.pityRare = 0;
    userData.pityEpic = 0;
    userData.pityLegendary = 0;
  } else if (rarity === "epic") {
    userData.pityRare = 0;
    userData.pityEpic = 0;
  } else if (rarity === "rare") {
    userData.pityRare = 0;
  }
  userData.pityCounter = userData.pityLegendaryRare ?? 0;

  await kv.set(userKey, userData);

  return {
    success: true,
    status: isDuplicate ? "duplicate" : "ok",
    fragmentsAdded,
  };
}

/**
 * Rollback reserved draw.
 * Restores one draw and reverts pity increments from Phase 1.
 */
async function rollbackReservedDraw(userKey: string): Promise<void> {
  const data = await kv.get<UserCards>(userKey);
  if (!data) {
    throw new Error("Rollback reserve draw failed: missing user data");
  }
  const userData = normalizeUserCards(data);

  userData.drawsAvailable += 1;
  userData.pityRare = Math.max(0, (userData.pityRare ?? 0) - 1);
  userData.pityEpic = Math.max(0, (userData.pityEpic ?? 0) - 1);
  userData.pityLegendary = Math.max(0, (userData.pityLegendary ?? 0) - 1);
  userData.pityLegendaryRare = Math.max(0, (userData.pityLegendaryRare ?? 0) - 1);
  userData.pityCounter = userData.pityLegendaryRare ?? 0;

  await kv.set(userKey, userData);
}

/**
 * Main draw function.
 * Two-phase approach to prevent race conditions:
 * Phase 1: Reserve draw (check & decrement drawsAvailable, increment pityCounter)
 * Phase 2: Finalize draw (add card, handle duplicates, reset pity)
 * Card selection happens between phases (requires randomness).
 */
export async function drawCard(userId: string): Promise<{
  success: boolean;
  card?: CardConfig;
  message?: string;
  isDuplicate?: boolean;
  fragmentsAdded?: number;
}> {
  const userKey = `cards:user:${userId}`;

  return withUserEconomyLock(userId, async () => {
    const reserve = await reserveDraw(userKey);

    if (!reserve.success) {
      return { success: false, message: "抽卡次数不足" };
    }

    const pityCounters = normalizePityCounters(reserve.pityCounters!);
    const card = selectCardForDraw(pityCounters);
    const fragmentValue = FRAGMENT_VALUES[card.rarity];

    try {
      const result = await finalizeDraw(userKey, card.id, card.rarity, fragmentValue);

      return {
        success: true,
        card,
        isDuplicate: result.status === "duplicate",
        fragmentsAdded: result.fragmentsAdded > 0 ? result.fragmentsAdded : undefined,
      };
    } catch (error) {
      try {
        await rollbackReservedDraw(userKey);
      } catch (rollbackError) {
        console.error("Rollback draw failed:", rollbackError);
      }
      console.error("Finalize draw failed:", error);
      return { success: false, message: "抽卡异常，请重试" };
    }
  });
}
