import { kv } from '@/lib/d1-kv';
import { CARDS } from "./config";
import { CardConfig, Rarity } from "./types";
import { RARITY_PROBABILITIES, RARITY_LEVELS } from "./constants";
import { getGuaranteedRarity, normalizePityCounters, type PityCounters } from "./pity";
import { getCardRulesConfig, type CardRulesConfig } from "./rules";
import { secureRandomFloat, secureRandomIndex } from "../random";
import { withUserEconomyLock } from "../economy-lock";
import {
  deleteNativeUserCards,
  getNativeUserCards,
  isNativeHotStoreReady,
  setNativeUserCards,
} from "@/lib/hot-d1";

export interface RecentDraw {
  cardId: string;
  rarity: Rarity;
  isDuplicate: boolean;
  fragmentsAdded: number;
  timestamp: number;
}

const RECENT_DRAWS_LIMIT = 10;

export interface CardDrawResult {
  card: CardConfig;
  isDuplicate: boolean;
  fragmentsAdded?: number;
}

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
  /** 最近抽卡历史，最多保留 RECENT_DRAWS_LIMIT 条，最新在前 */
  recentDraws?: RecentDraw[];
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
  recentDraws: [],
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
    recentDraws: [],
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

  const validRarities: Rarity[] = ['legendary_rare', 'legendary', 'epic', 'rare', 'common'];
  const recentDraws: RecentDraw[] = Array.isArray(data?.recentDraws)
    ? data.recentDraws
        .map((entry): RecentDraw | null => {
          if (!entry || typeof entry !== 'object') return null;
          const draw = entry as Partial<RecentDraw>;
          const timestamp = Number(draw.timestamp);
          const fragmentsAdded = Number(draw.fragmentsAdded);
          if (typeof draw.cardId !== 'string' || !draw.cardId) return null;
          if (typeof draw.rarity !== 'string' || !validRarities.includes(draw.rarity as Rarity)) return null;
          if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
          return {
            cardId: draw.cardId,
            rarity: draw.rarity as Rarity,
            isDuplicate: !!draw.isDuplicate,
            fragmentsAdded: Number.isFinite(fragmentsAdded) ? Math.max(0, Math.floor(fragmentsAdded)) : 0,
            timestamp: Math.floor(timestamp),
          };
        })
        .filter((draw): draw is RecentDraw => draw !== null)
        .slice(0, RECENT_DRAWS_LIMIT)
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
    recentDraws,
  };
}

function getUserCardsKey(userId: string): string {
  return `cards:user:${userId}`;
}

function parseNativeUserId(userId: string): number | null {
  const parsed = Number(userId);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function mergeUserCards(primary: Partial<UserCards>, secondary: Partial<UserCards>): UserCards {
  const a = normalizeUserCards(primary);
  const b = normalizeUserCards(secondary);
  const pityLegendaryRare = Math.max(a.pityLegendaryRare ?? 0, b.pityLegendaryRare ?? 0);

  return {
    inventory: uniqueStrings([...a.inventory, ...b.inventory]),
    fragments: Math.max(a.fragments, b.fragments),
    pityRare: Math.max(a.pityRare ?? 0, b.pityRare ?? 0),
    pityEpic: Math.max(a.pityEpic ?? 0, b.pityEpic ?? 0),
    pityLegendary: Math.max(a.pityLegendary ?? 0, b.pityLegendary ?? 0),
    pityLegendaryRare,
    pityCounter: pityLegendaryRare,
    drawsAvailable: Math.max(a.drawsAvailable, b.drawsAvailable),
    collectionRewards: uniqueStrings([...a.collectionRewards, ...b.collectionRewards]),
    recentDraws: [...(a.recentDraws ?? []), ...(b.recentDraws ?? [])]
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, RECENT_DRAWS_LIMIT),
  };
}

function isSameUserCards(a: UserCards, b: UserCards): boolean {
  return JSON.stringify(normalizeUserCards(a)) === JSON.stringify(normalizeUserCards(b));
}

async function shouldUseNativeCards(userId: string): Promise<number | null> {
  const nativeUserId = parseNativeUserId(userId);
  if (nativeUserId === null) {
    return null;
  }

  return (await isNativeHotStoreReady()) ? nativeUserId : null;
}

export async function getUserCardData(userId: string): Promise<UserCards> {
  const nativeUserId = await shouldUseNativeCards(userId);
  if (nativeUserId !== null) {
    const legacyKey = getUserCardsKey(userId);
    const [nativeData, legacyData] = await Promise.all([
      getNativeUserCards(nativeUserId),
      kv.get<Partial<UserCards>>(legacyKey),
    ]);

    if (nativeData !== null && legacyData !== null && legacyData !== undefined) {
      // 故障期间两边可能分叉：native 有新增次数，旧 KV 有实际抽到的卡。
      const merged = mergeUserCards(nativeData, legacyData);
      const normalizedNative = normalizeUserCards(nativeData);
      const normalizedLegacy = normalizeUserCards(legacyData);
      if (!isSameUserCards(merged, normalizedNative) || !isSameUserCards(merged, normalizedLegacy)) {
        await Promise.all([
          setNativeUserCards(nativeUserId, merged),
          kv.set(legacyKey, merged),
        ]);
      }
      return merged;
    }

    if (nativeData !== null) {
      return normalizeUserCards(nativeData);
    }

    // 读穿旧 KV，避免热路径开启后未迁移用户看不到原有卡牌数据。
    const normalized = normalizeUserCards(legacyData);
    if (legacyData !== null && legacyData !== undefined) {
      await Promise.all([
        setNativeUserCards(nativeUserId, normalized),
        kv.set(legacyKey, normalized),
      ]);
    }
    return normalized;
  }

  const data = await kv.get<UserCards>(getUserCardsKey(userId));
  return normalizeUserCards(data);
}

export async function updateUserCardData(userId: string, data: UserCards): Promise<void> {
  const normalized = normalizeUserCards(data);
  const nativeUserId = await shouldUseNativeCards(userId);
  if (nativeUserId !== null) {
    await Promise.all([
      setNativeUserCards(nativeUserId, normalized),
      kv.set(getUserCardsKey(userId), normalized),
    ]);
    return;
  }

  await kv.set(getUserCardsKey(userId), normalized);
}

export async function deleteUserCardData(userId: string): Promise<void> {
  const nativeUserId = await shouldUseNativeCards(userId);
  if (nativeUserId !== null) {
    await deleteNativeUserCards(nativeUserId);
  }
  await kv.del(getUserCardsKey(userId));
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
export function selectCardByProbability(
  probabilities: Record<Rarity, number> = RARITY_PROBABILITIES,
): CardConfig {
  const rarities = Object.keys(probabilities) as Rarity[];
  const totalWeight = rarities.reduce((sum, r) => sum + probabilities[r], 0);

  let random = secureRandomFloat() * totalWeight;
  let selectedRarity: Rarity = "common";

  for (const rarity of rarities) {
    random -= probabilities[rarity];
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
function selectCardForDraw(counters: PityCounters, rules: CardRulesConfig): CardConfig {
  const guaranteed = getGuaranteedRarity(counters, rules.pityThresholds);
  if (!guaranteed) return selectCardByProbability(rules.rarityProbabilities);

  const minLevel = RARITY_LEVELS[guaranteed];
  const eligibleCards = CARDS.filter((c) => RARITY_LEVELS[c.rarity] >= minLevel);
  return eligibleCards[secureRandomIndex(eligibleCards.length)]!;
}

function incrementPityCounters(userData: UserCards): PityCounters {
  userData.pityRare = (userData.pityRare ?? 0) + 1;
  userData.pityEpic = (userData.pityEpic ?? 0) + 1;
  userData.pityLegendary = (userData.pityLegendary ?? 0) + 1;
  userData.pityLegendaryRare = (userData.pityLegendaryRare ?? 0) + 1;
  userData.pityCounter = userData.pityLegendaryRare;

  return {
    rare: userData.pityRare,
    epic: userData.pityEpic,
    legendary: userData.pityLegendary,
    legendary_rare: userData.pityLegendaryRare,
  };
}

function resetPityCountersAfterDraw(userData: UserCards, rarity: Rarity): void {
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
}

function applyDrawToUserCards(
  userData: UserCards,
  card: CardConfig,
  rules: CardRulesConfig,
  timestamp: number,
): CardDrawResult {
  const isDuplicate = userData.inventory.includes(card.id);
  const fragmentValue = rules.fragmentValues[card.rarity];
  let fragmentsAdded = 0;

  if (isDuplicate) {
    userData.fragments += fragmentValue;
    fragmentsAdded = fragmentValue;
  } else {
    userData.inventory.push(card.id);
  }

  resetPityCountersAfterDraw(userData, card.rarity);

  const draw: RecentDraw = {
    cardId: card.id,
    rarity: card.rarity,
    isDuplicate,
    fragmentsAdded,
    timestamp,
  };
  userData.recentDraws = [draw, ...(userData.recentDraws ?? [])].slice(0, RECENT_DRAWS_LIMIT);

  return {
    card,
    isDuplicate,
    fragmentsAdded: fragmentsAdded > 0 ? fragmentsAdded : undefined,
  };
}

export async function drawCards(userId: string, count: number): Promise<{
  success: boolean;
  results?: CardDrawResult[];
  drawsAvailable?: number;
  message?: string;
}> {
  const drawCount = Math.floor(Number(count));
  if (!Number.isSafeInteger(drawCount) || drawCount < 1 || drawCount > 10) {
    return { success: false, message: "抽卡次数参数无效" };
  }

  return withUserEconomyLock(userId, async () => {
    const userData = await getUserCardData(userId);

    if (userData.drawsAvailable < drawCount) {
      return {
        success: false,
        drawsAvailable: userData.drawsAvailable,
        message: `抽卡次数不足，需要${drawCount}次，当前${userData.drawsAvailable}次`,
      };
    }

    const rules = await getCardRulesConfig();
    const results: CardDrawResult[] = [];
    const now = Date.now();

    for (let index = 0; index < drawCount; index += 1) {
      userData.drawsAvailable -= 1;
      const pityCounters = normalizePityCounters(incrementPityCounters(userData));
      const card = selectCardForDraw(pityCounters, rules);
      results.push(applyDrawToUserCards(userData, card, rules, now + index));
    }

    await updateUserCardData(userId, userData);

    return {
      success: true,
      results,
      drawsAvailable: userData.drawsAvailable,
    };
  });
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
  const userId = userKey.replace(/^cards:user:/, "");
  const userData = await getUserCardData(userId);

  if (userData.drawsAvailable <= 0) {
    return { success: false, status: "no_draws" };
  }

  userData.drawsAvailable -= 1;
  const pityCounters = incrementPityCounters(userData);

  await updateUserCardData(userId, userData);

  return {
    success: true,
    pityCounters,
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
  const userId = userKey.replace(/^cards:user:/, "");
  const userData = await getUserCardData(userId);

  const isDuplicate = userData.inventory.includes(cardId);

  let fragmentsAdded = 0;
  if (isDuplicate) {
    userData.fragments += fragmentValue;
    fragmentsAdded = fragmentValue;
  } else {
    userData.inventory.push(cardId);
  }

  resetPityCountersAfterDraw(userData, rarity as Rarity);

  const draw: RecentDraw = {
    cardId,
    rarity: rarity as Rarity,
    isDuplicate,
    fragmentsAdded,
    timestamp: Date.now(),
  };
  userData.recentDraws = [draw, ...(userData.recentDraws ?? [])].slice(0, RECENT_DRAWS_LIMIT);

  await updateUserCardData(userId, userData);

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
  const userId = userKey.replace(/^cards:user:/, "");
  const userData = await getUserCardData(userId);

  userData.drawsAvailable += 1;
  userData.pityRare = Math.max(0, (userData.pityRare ?? 0) - 1);
  userData.pityEpic = Math.max(0, (userData.pityEpic ?? 0) - 1);
  userData.pityLegendary = Math.max(0, (userData.pityLegendary ?? 0) - 1);
  userData.pityLegendaryRare = Math.max(0, (userData.pityLegendaryRare ?? 0) - 1);
  userData.pityCounter = userData.pityLegendaryRare ?? 0;

  await updateUserCardData(userId, userData);
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

    const rules = await getCardRulesConfig();
    const pityCounters = normalizePityCounters(reserve.pityCounters!);
    const card = selectCardForDraw(pityCounters, rules);
    const fragmentValue = rules.fragmentValues[card.rarity];

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
