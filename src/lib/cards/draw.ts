import { kv } from "@vercel/kv";
import { CARDS } from "./config";
import { CardConfig, Rarity } from "./types";
import { RARITY_PROBABILITIES, RARITY_LEVELS, FRAGMENT_VALUES } from "./constants";
import { checkPityTrigger, getGuaranteedRarity, shouldResetPity } from "./pity";

export interface UserCards {
  inventory: string[];
  fragments: number;
  pityCounter: number;
  drawsAvailable: number;
  collectionRewards: string[];
}

const DEFAULT_USER_CARDS: UserCards = {
  inventory: [],
  fragments: 0,
  pityCounter: 0,
  drawsAvailable: 1,
  collectionRewards: [],
};

function normalizeUserCards(data: Partial<UserCards> | null | undefined): UserCards {
  const inventory = Array.isArray(data?.inventory)
    ? data.inventory.filter((id): id is string => typeof id === "string")
    : [];

  const fragmentsRaw = Number(data?.fragments);
  const fragments = Number.isFinite(fragmentsRaw) ? Math.max(0, Math.floor(fragmentsRaw)) : DEFAULT_USER_CARDS.fragments;

  const pityRaw = Number(data?.pityCounter);
  const pityCounter = Number.isFinite(pityRaw) ? Math.max(0, Math.floor(pityRaw)) : DEFAULT_USER_CARDS.pityCounter;

  const drawsRaw = Number(data?.drawsAvailable);
  const drawsAvailable = Number.isFinite(drawsRaw)
    ? Math.max(0, Math.floor(drawsRaw))
    : DEFAULT_USER_CARDS.drawsAvailable;

  const collectionRewards = Array.isArray(data?.collectionRewards)
    ? data.collectionRewards.filter((id): id is string => typeof id === "string")
    : [];

  return { inventory, fragments, pityCounter, drawsAvailable, collectionRewards };
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
function selectCardForDraw(newPityCounter: number): CardConfig {
  if (checkPityTrigger(newPityCounter)) {
    const minRarity = getGuaranteedRarity(newPityCounter);
    if (minRarity) {
      const minLevel = RARITY_LEVELS[minRarity];
      const eligibleCards = CARDS.filter((c) => RARITY_LEVELS[c.rarity] >= minLevel);
      return eligibleCards[Math.floor(Math.random() * eligibleCards.length)];
    }
  }
  return selectCardByProbability();
}

/**
 * Lua script for Phase 1: Reserve draw
 * Atomically checks drawsAvailable, decrements it, increments pityCounter.
 * Returns [success, newPityCounter, status]
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
      drawsAvailable = 1,
      collectionRewards = {}
    }
  end

  -- Check draws available
  if (userData.drawsAvailable or 0) <= 0 then
    return {0, 0, 'no_draws'}
  end

  -- Decrement draws available and increment pity counter
  userData.drawsAvailable = userData.drawsAvailable - 1
  userData.pityCounter = (userData.pityCounter or 0) + 1
  
  redis.call('SET', userKey, cjson.encode(userData))
  
  return {1, userData.pityCounter, 'ok'}
`;

/**
 * Lua script for Phase 2: Finalize draw
 * Adds card to inventory (or converts to fragments if duplicate), resets pity if needed.
 * Returns [success, status, fragmentsAdded]
 */
const FINALIZE_DRAW_SCRIPT = `
  local userKey = KEYS[1]
  local cardId = ARGV[1]
  local shouldReset = ARGV[2] == "true"
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

  -- Reset pity if applicable
  if shouldReset then
    userData.pityCounter = 0
  end

  redis.call('SET', userKey, cjson.encode(userData))

  if isDuplicate then
    return {1, 'duplicate', fragmentsAdded}
  else
    return {1, 'ok', 0}
  end
`;

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

  // Phase 1: Atomically reserve the draw and get actual pityCounter
  const reserveResult = (await kv.eval(RESERVE_DRAW_SCRIPT, [userKey], [])) as [number, number, string];
  const [reserveSuccess, actualPityCounter, reserveStatus] = reserveResult;

  if (reserveSuccess !== 1) {
    return { success: false, message: "抽卡次数不足" };
  }

  // Card selection based on ACTUAL pityCounter (outside Lua, uses randomness)
  const card = selectCardForDraw(actualPityCounter);

  // Determine if pity should reset based on the selected card
  const shouldReset = shouldResetPity(actualPityCounter, card.rarity);

  // Get fragment value for duplicate handling
  const fragmentValue = FRAGMENT_VALUES[card.rarity];

  // Phase 2: Finalize the draw
  const finalizeResult = (await kv.eval(FINALIZE_DRAW_SCRIPT, [userKey], [
    card.id,
    String(shouldReset),
    fragmentValue,
  ])) as [number, string, number];

  const [, status, fragmentsAdded] = finalizeResult;

  return {
    success: true,
    card,
    isDuplicate: status === "duplicate",
    fragmentsAdded: fragmentsAdded > 0 ? fragmentsAdded : undefined,
  };
}
