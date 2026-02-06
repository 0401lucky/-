import { kv } from "@vercel/kv";
import { CARDS } from "./config";
import { CardConfig, Rarity } from "./types";
import { RARITY_PROBABILITIES, RARITY_LEVELS, FRAGMENT_VALUES } from "./constants";
import { getGuaranteedRarity, normalizePityCounters, type PityCounters } from "./pity";

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

function normalizeUserCards(data: Partial<UserCards> | null | undefined): UserCards {
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
  await kv.set(`cards:user:${userId}`, data);
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

  return cardsInRarity[Math.floor(Math.random() * cardsInRarity.length)];
}

/**
 * Selects a card based on probability weights.
 * First selects a rarity tier based on RARITY_PROBABILITIES,
 * then selects a random card within that tier.
 */
export function selectCardByProbability(): CardConfig {
  const rarities = Object.keys(RARITY_PROBABILITIES) as Rarity[];
  const totalWeight = rarities.reduce((sum, r) => sum + RARITY_PROBABILITIES[r], 0);

  let random = Math.random() * totalWeight;
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
  return eligibleCards[Math.floor(Math.random() * eligibleCards.length)];
}

/**
 * Lua script for Phase 1: Reserve draw
 * Atomically checks drawsAvailable, decrements it, increments pity counters.
 * Returns [success, pityRare, pityEpic, pityLegendary, pityLegendaryRare, status]
 */
const RESERVE_DRAW_SCRIPT = `
  local userKey = KEYS[1]
  
  local data = redis.call('GET', userKey)
  local userData
  if data then
    userData = cjson.decode(data)
  else
    userData = {
      inventory = {},
      fragments = 0,
      pityCounter = 0,
      pityRare = 0,
      pityEpic = 0,
      pityLegendary = 0,
      pityLegendaryRare = 0,
      drawsAvailable = 1,
      collectionRewards = {}
    }
  end

  -- Migrate legacy field -> new structure
  if userData.pityLegendaryRare == nil then
    userData.pityLegendaryRare = tonumber(userData.pityCounter) or 0
  end
  if userData.pityRare == nil then userData.pityRare = 0 end
  if userData.pityEpic == nil then userData.pityEpic = 0 end
  if userData.pityLegendary == nil then userData.pityLegendary = 0 end
  userData.pityCounter = tonumber(userData.pityLegendaryRare) or 0

  -- Check draws available
  if (userData.drawsAvailable or 0) <= 0 then
    return {0, 0, 0, 0, 0, 'no_draws'}
  end

  -- Decrement draws available and increment pity counters
  userData.drawsAvailable = userData.drawsAvailable - 1
  userData.pityRare = (tonumber(userData.pityRare) or 0) + 1
  userData.pityEpic = (tonumber(userData.pityEpic) or 0) + 1
  userData.pityLegendary = (tonumber(userData.pityLegendary) or 0) + 1
  userData.pityLegendaryRare = (tonumber(userData.pityLegendaryRare) or 0) + 1
  userData.pityCounter = tonumber(userData.pityLegendaryRare) or 0
  
  redis.call('SET', userKey, cjson.encode(userData))
  
  return {1, userData.pityRare, userData.pityEpic, userData.pityLegendary, userData.pityLegendaryRare, 'ok'}
`;

/**
 * Lua script for Phase 2: Finalize draw
 * Adds card to inventory (or converts to fragments if duplicate), resets pity tiers if needed.
 * Returns [success, status, fragmentsAdded]
 */
const FINALIZE_DRAW_SCRIPT = `
  local userKey = KEYS[1]
  local cardId = ARGV[1]
  local rarity = ARGV[2]
  local fragmentValue = tonumber(ARGV[3])

  local data = redis.call('GET', userKey)
  local userData = cjson.decode(data)

  -- Check if card is duplicate
  local isDuplicate = false
  for _, id in ipairs(userData.inventory or {}) do
    if id == cardId then
      isDuplicate = true
      break
    end
  end

  local fragmentsAdded = 0
  if isDuplicate then
    userData.fragments = (userData.fragments or 0) + fragmentValue
    fragmentsAdded = fragmentValue
  else
    if not userData.inventory then
      userData.inventory = {}
    end
    table.insert(userData.inventory, cardId)
  end

  -- Ensure pity counters exist & migrate legacy field
  if userData.pityLegendaryRare == nil then
    userData.pityLegendaryRare = tonumber(userData.pityCounter) or 0
  end
  local pityRare = tonumber(userData.pityRare) or 0
  local pityEpic = tonumber(userData.pityEpic) or 0
  local pityLegendary = tonumber(userData.pityLegendary) or 0
  local pityLegendaryRare = tonumber(userData.pityLegendaryRare) or 0

  -- Reset pity tiers based on drawn rarity (tiered cyclic pity)
  if rarity == 'legendary_rare' then
    pityRare = 0
    pityEpic = 0
    pityLegendary = 0
    pityLegendaryRare = 0
  elseif rarity == 'legendary' then
    pityRare = 0
    pityEpic = 0
    pityLegendary = 0
  elseif rarity == 'epic' then
    pityRare = 0
    pityEpic = 0
  elseif rarity == 'rare' then
    pityRare = 0
  end

  userData.pityRare = pityRare
  userData.pityEpic = pityEpic
  userData.pityLegendary = pityLegendary
  userData.pityLegendaryRare = pityLegendaryRare
  userData.pityCounter = pityLegendaryRare

  redis.call('SET', userKey, cjson.encode(userData))

  if isDuplicate then
    return {1, 'duplicate', fragmentsAdded}
  else
    return {1, 'ok', 0}
  end
`;

/**
 * Lua script for rollback when Phase 2 fails.
 * Restores one draw and reverts pity increments from Phase 1.
 */
const ROLLBACK_RESERVE_DRAW_SCRIPT = `
  local userKey = KEYS[1]
  local data = redis.call('GET', userKey)
  if not data then
    return {0, 'missing_user_data'}
  end

  local ok, userData = pcall(cjson.decode, data)
  if not ok or not userData then
    return {0, 'invalid_user_data'}
  end

  local drawsAvailable = tonumber(userData.drawsAvailable) or 0
  userData.drawsAvailable = drawsAvailable + 1

  local pityRare = (tonumber(userData.pityRare) or 0) - 1
  if pityRare < 0 then pityRare = 0 end

  local pityEpic = (tonumber(userData.pityEpic) or 0) - 1
  if pityEpic < 0 then pityEpic = 0 end

  local pityLegendary = (tonumber(userData.pityLegendary) or 0) - 1
  if pityLegendary < 0 then pityLegendary = 0 end

  local pityLegendaryRare = (tonumber(userData.pityLegendaryRare) or tonumber(userData.pityCounter) or 0) - 1
  if pityLegendaryRare < 0 then pityLegendaryRare = 0 end

  userData.pityRare = pityRare
  userData.pityEpic = pityEpic
  userData.pityLegendary = pityLegendary
  userData.pityLegendaryRare = pityLegendaryRare
  userData.pityCounter = pityLegendaryRare

  redis.call('SET', userKey, cjson.encode(userData))
  return {1, 'ok'}
`;

async function rollbackReservedDraw(userKey: string): Promise<void> {
  const rollbackResult = await kv.eval(ROLLBACK_RESERVE_DRAW_SCRIPT, [userKey], []);
  if (!Array.isArray(rollbackResult) || Number(rollbackResult[0]) !== 1) {
    throw new Error("Rollback reserve draw failed");
  }
}

/**
 * Main draw function.
 * Uses two-phase Lua scripts for atomic operations to prevent race conditions.
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

  // Phase 1: Atomically reserve the draw and get actual pity counters
  const reserveResult = (await kv.eval(RESERVE_DRAW_SCRIPT, [userKey], [])) as unknown;
  if (!Array.isArray(reserveResult) || reserveResult.length < 6) {
    throw new Error("Invalid reserve draw response");
  }

  const [reserveSuccessRaw, pityRareRaw, pityEpicRaw, pityLegendaryRaw, pityLegendaryRareRaw] = reserveResult as unknown[];
  const reserveSuccess = Number(reserveSuccessRaw);

  if (reserveSuccess !== 1) {
    return { success: false, message: "抽卡次数不足" };
  }

  const pityCounters = normalizePityCounters({
    rare: Number(pityRareRaw),
    epic: Number(pityEpicRaw),
    legendary: Number(pityLegendaryRaw),
    legendary_rare: Number(pityLegendaryRareRaw),
  });

  // Card selection based on ACTUAL pity counters (outside Lua, uses randomness)
  const card = selectCardForDraw(pityCounters);

  // Get fragment value for duplicate handling
  const fragmentValue = FRAGMENT_VALUES[card.rarity];

  // Phase 2: Finalize the draw
  let finalizeResult: [number, string, number];
  try {
    const finalizeResultRaw = await kv.eval(FINALIZE_DRAW_SCRIPT, [userKey], [
      card.id,
      card.rarity,
      fragmentValue,
    ]);

    if (!Array.isArray(finalizeResultRaw) || finalizeResultRaw.length < 3) {
      throw new Error("Invalid finalize draw response");
    }

    finalizeResult = finalizeResultRaw as [number, string, number];
  } catch (error) {
    try {
      await rollbackReservedDraw(userKey);
    } catch (rollbackError) {
      console.error("Rollback draw failed:", rollbackError);
    }
    console.error("Finalize draw failed:", error);
    return { success: false, message: "抽卡异常，请重试" };
  }

  const [, status, fragmentsAdded] = finalizeResult;

  return {
    success: true,
    card,
    isDuplicate: status === "duplicate",
    fragmentsAdded: fragmentsAdded > 0 ? fragmentsAdded : undefined,
  };
}
