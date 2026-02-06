import { kv } from "@vercel/kv";
import { CARDS, getCardsByAlbum, getAlbumById } from "./config";
import { COLLECTION_REWARDS } from "./constants";
import { Rarity } from "./types";
import { UserCards } from "./draw";
import { nanoid } from "nanoid";
import { getAlbumReward } from "./albumRewards";
import type { PointsLog } from "../types/store";

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

const USER_POINTS_LOG_MAX = 100;

/**
 * Get all cards of a specific rarity (optionally filtered by album)
 */
export function getCardsByRarity(rarity: Rarity, albumId?: string): string[] {
  const cards = albumId ? getCardsByAlbum(albumId) : CARDS;
  return cards.filter(c => c.rarity === rarity).map(c => c.id);
}

/**
 * Count how many unique cards of a rarity the user owns (optionally filtered by album)
 */
export function countOwnedByRarity(inventory: string[], rarity: Rarity, albumId?: string): number {
  const rarityCards = getCardsByRarity(rarity, albumId);
  const ownedSet = new Set(inventory);
  return rarityCards.filter(cardId => ownedSet.has(cardId)).length;
}

/**
 * Check if user has completed a tier collection (optionally filtered by album)
 */
export function isTierComplete(inventory: string[], rarity: Rarity, albumId?: string): boolean {
  const rarityCards = getCardsByRarity(rarity, albumId);
  const ownedSet = new Set(inventory);
  return rarityCards.every(cardId => ownedSet.has(cardId));
}

/**
 * Check if user has completed the full collection of an album
 */
export function isAlbumComplete(inventory: string[], albumId: string): boolean {
  const albumCards = getCardsByAlbum(albumId);
  const ownedSet = new Set(inventory);
  return albumCards.every(card => ownedSet.has(card.id));
}

/**
 * Get reward key for tracking claimed rewards
 */
export function getRewardKey(type: RewardType, albumId?: string): string {
  if (albumId) {
    return `album:${albumId}:${type}`;
  }
  return `collection:${type}`;
}

/**
 * Check if a reward has been claimed
 */
export function isRewardClaimed(userData: UserCards, type: RewardType, albumId?: string): boolean {
  return userData.collectionRewards.includes(getRewardKey(type, albumId));
}

/**
 * Get status of all collection rewards for a user within an album
 */
export async function getAlbumRewardStatuses(userData: UserCards, albumId: string): Promise<RewardStatus[]> {
  const rarities: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'legendary_rare'];
  const statuses: RewardStatus[] = [];
  const album = getAlbumById(albumId);
  const albumCards = getCardsByAlbum(albumId);

  // Tier rewards - use album-specific rewards if available, otherwise fall back to global
  for (const rarity of rarities) {
    const rarityCards = albumCards.filter(c => c.rarity === rarity);
    if (rarityCards.length === 0) continue; // Skip if no cards of this rarity in album

    const ownedCount = countOwnedByRarity(userData.inventory, rarity, albumId);
    const totalCount = rarityCards.length;
    const eligible = isTierComplete(userData.inventory, rarity, albumId);
    const claimed = isRewardClaimed(userData, rarity, albumId);

    // Use album-specific tier rewards if available
    const points = album?.tierRewards?.[rarity] ?? COLLECTION_REWARDS[rarity];

    statuses.push({
      type: rarity,
      points,
      claimed,
      eligible,
      ownedCount,
      totalCount,
    });
  }

  // Full album reward - use dynamic reward from Redis
  const fullSetEligible = isAlbumComplete(userData.inventory, albumId);
  const ownedInAlbum = albumCards.filter(c => userData.inventory.includes(c.id)).length;
  const fullSetReward = await getAlbumReward(albumId);

  statuses.push({
    type: 'full_set',
    points: fullSetReward,
    claimed: isRewardClaimed(userData, 'full_set', albumId),
    eligible: fullSetEligible,
    ownedCount: ownedInAlbum,
    totalCount: albumCards.length,
  });

  return statuses;
}

/**
 * Claim a collection reward for an album
 * Uses Lua script for atomic check-and-claim to prevent race conditions
 */
export async function claimCollectionReward(
  userId: string,
  rewardType: RewardType,
  albumId: string
): Promise<ClaimResult> {
  const albumCards = getCardsByAlbum(albumId);

  // Get required card IDs for this reward type
  const requiredCardIds = rewardType === 'full_set'
    ? albumCards.map(c => c.id)
    : albumCards.filter(c => c.rarity === rewardType).map(c => c.id);

  if (requiredCardIds.length === 0) {
    return { success: false, message: "该卡册没有此稀有度的卡牌" };
  }

  const rewardKey = getRewardKey(rewardType, albumId);
  const userKey = `cards:user:${userId}`;
  const pointsKey = `points:${userId}`;
  const pointsLogKey = `points_log:${userId}`;

  // Get dynamic reward points: tier rewards use album-specific or constants, full_set uses album reward
  let points: number;
  if (rewardType === 'full_set') {
    points = await getAlbumReward(albumId);
  } else {
    const album = getAlbumById(albumId);
    points = album?.tierRewards?.[rewardType] ?? COLLECTION_REWARDS[rewardType];
  }

  const pointsToAward = Math.max(0, Math.floor(points));
  if (pointsToAward <= 0) {
    return { success: false, message: "奖励积分配置异常" };
  }

  // Lua script for atomic claim operation
  const luaScript = `
    local userKey = KEYS[1]
    local pointsKey = KEYS[2]
    local rewardKey = ARGV[1]
    local requiredCardsJson = ARGV[2]
    local points = tonumber(ARGV[3])

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

    -- Atomically mark as claimed and award points
    table.insert(userData.collectionRewards, rewardKey)
    local newBalance = redis.call('INCRBY', pointsKey, points)
    redis.call('SET', userKey, cjson.encode(userData))

    return {1, 'ok', newBalance}
  `;

  const result = await kv.eval(
    luaScript,
    [userKey, pointsKey],
    [rewardKey, JSON.stringify(requiredCardIds), pointsToAward]
  ) as [number, string, number?];

  const [success, status, newBalanceRaw] = result;

  if (success !== 1) {
    if (status === 'already_claimed') {
      return { success: false, message: "该奖励已领取" };
    }
    return { success: false, message: "尚未集齐该系列卡牌" };
  }

  const newBalance = Number(newBalanceRaw);
  if (!Number.isFinite(newBalance)) {
    return { success: false, message: "奖励发放异常，请稍后重试" };
  }

  const rarityNames: Record<RewardType, string> = {
    common: '普通',
    rare: '稀有',
    epic: '史诗',
    legendary: '传说',
    legendary_rare: '传说稀有',
    full_set: '全套',
  };

  const description = `集齐${rarityNames[rewardType]}卡牌奖励`;

  const log: PointsLog = {
    id: nanoid(),
    amount: pointsToAward,
    source: 'card_collection',
    description,
    balance: Math.floor(newBalance),
    createdAt: Date.now(),
  };

  try {
    await kv.lpush(pointsLogKey, log);
    await kv.ltrim(pointsLogKey, 0, USER_POINTS_LOG_MAX - 1);
  } catch (error) {
    console.error("Claim reward log write failed:", error);
  }

  return {
    success: true,
    pointsAwarded: pointsToAward,
    newBalance: Math.floor(newBalance),
  };
}
