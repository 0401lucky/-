import { kv } from "@vercel/kv";
import { CARDS } from "./config";
import { COLLECTION_REWARDS } from "./constants";
import { Rarity } from "./types";
import { UserCards } from "./draw";
import { addPoints } from "../points";

export type RewardType = Rarity | 'full_set';

export interface RewardStatus {
  type: RewardType;
  points: number;
  claimed: boolean;
  eligible: boolean;
  ownedCount: number;
  totalCount: number;
}

export interface ClaimResult {
  success: boolean;
  message?: string;
  pointsAwarded?: number;
  newBalance?: number;
}

/**
 * Get all cards of a specific rarity
 */
export function getCardsByRarity(rarity: Rarity): string[] {
  return CARDS.filter(c => c.rarity === rarity).map(c => c.id);
}

/**
 * Count how many unique cards of a rarity the user owns
 */
export function countOwnedByRarity(inventory: string[], rarity: Rarity): number {
  const rarityCards = getCardsByRarity(rarity);
  const ownedSet = new Set(inventory);
  return rarityCards.filter(cardId => ownedSet.has(cardId)).length;
}

/**
 * Check if user has completed a tier collection
 */
export function isTierComplete(inventory: string[], rarity: Rarity): boolean {
  const rarityCards = getCardsByRarity(rarity);
  const ownedSet = new Set(inventory);
  return rarityCards.every(cardId => ownedSet.has(cardId));
}

/**
 * Check if user has completed the full collection
 */
export function isFullCollectionComplete(inventory: string[]): boolean {
  const ownedSet = new Set(inventory);
  return CARDS.every(card => ownedSet.has(card.id));
}

/**
 * Get reward key for tracking claimed rewards
 */
export function getRewardKey(type: RewardType): string {
  return `collection:${type}`;
}

/**
 * Check if a reward has been claimed
 */
export function isRewardClaimed(userData: UserCards, type: RewardType): boolean {
  return userData.collectionRewards.includes(getRewardKey(type));
}

/**
 * Get status of all collection rewards for a user
 */
export function getRewardStatuses(userData: UserCards): RewardStatus[] {
  const rarities: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'legendary_rare'];
  const statuses: RewardStatus[] = [];

  // Tier rewards
  for (const rarity of rarities) {
    const totalCount = getCardsByRarity(rarity).length;
    const ownedCount = countOwnedByRarity(userData.inventory, rarity);
    const eligible = isTierComplete(userData.inventory, rarity);
    const claimed = isRewardClaimed(userData, rarity);

    statuses.push({
      type: rarity,
      points: COLLECTION_REWARDS[rarity],
      claimed,
      eligible,
      ownedCount,
      totalCount,
    });
  }

  // Full set reward
  const fullSetEligible = isFullCollectionComplete(userData.inventory);
  statuses.push({
    type: 'full_set',
    points: COLLECTION_REWARDS.full_set,
    claimed: isRewardClaimed(userData, 'full_set'),
    eligible: fullSetEligible,
    ownedCount: new Set(userData.inventory).size,
    totalCount: CARDS.length,
  });

  return statuses;
}

/**
 * Claim a collection reward
 * Uses Lua script for atomic check-and-claim to prevent race conditions
 */
export async function claimCollectionReward(
  userId: string,
  rewardType: RewardType
): Promise<ClaimResult> {
  // Get required card IDs for this reward type
  const requiredCardIds = rewardType === 'full_set'
    ? CARDS.map(c => c.id)
    : getCardsByRarity(rewardType);

  const rewardKey = getRewardKey(rewardType);
  const userKey = `cards:user:${userId}`;
  const points = COLLECTION_REWARDS[rewardType];

  // Lua script for atomic claim operation
  const luaScript = `
    local userKey = KEYS[1]
    local rewardKey = ARGV[1]
    local requiredCardsJson = ARGV[2]

    local data = redis.call('GET', userKey)
    local userData
    if data then
      userData = cjson.decode(data)
    else
      userData = {
        inventory = {},
        fragments = 0,
        pityCounter = 0,
        drawsAvailable = 10,
        collectionRewards = {}
      }
    end

    -- Ensure collectionRewards exists
    if not userData.collectionRewards then
      userData.collectionRewards = {}
    end

    -- Check if already claimed
    for _, claimed in ipairs(userData.collectionRewards) do
      if claimed == rewardKey then
        return {0, 'already_claimed'}
      end
    end

    -- Check eligibility: user must have all required cards
    local requiredCards = cjson.decode(requiredCardsJson)
    local inventorySet = {}
    if userData.inventory then
      for _, cardId in ipairs(userData.inventory) do
        inventorySet[cardId] = true
      end
    end

    for _, requiredId in ipairs(requiredCards) do
      if not inventorySet[requiredId] then
        return {0, 'not_eligible'}
      end
    end

    -- Atomically mark as claimed
    table.insert(userData.collectionRewards, rewardKey)
    redis.call('SET', userKey, cjson.encode(userData))

    return {1, 'ok'}
  `;

  const result = await kv.eval(
    luaScript,
    [userKey],
    [rewardKey, JSON.stringify(requiredCardIds)]
  ) as [number, string];

  const [success, status] = result;

  if (success !== 1) {
    if (status === 'already_claimed') {
      return { success: false, message: "该奖励已领取" };
    }
    return { success: false, message: "尚未集齐该系列卡牌" };
  }

  // Award points (outside Lua script - independent system)
  const rarityNames: Record<RewardType, string> = {
    common: '普通',
    rare: '稀有',
    epic: '史诗',
    legendary: '传说',
    legendary_rare: '传说稀有',
    full_set: '全套',
  };

  const description = `集齐${rarityNames[rewardType]}卡牌奖励`;
  const pointsResult = await addPoints(Number(userId), points, 'card_collection', description);

  return {
    success: true,
    pointsAwarded: points,
    newBalance: pointsResult.balance,
  };
}
