import { CARDS, getCardsByAlbum, getAlbumById } from "./config";
import { COLLECTION_REWARDS } from "./constants";
import { Rarity } from "./types";
import { getUserCardData, normalizeUserCards, updateUserCardData, UserCards } from "./draw";
import { getAlbumReward } from "./albumRewards";
import { withUserEconomyLock } from "../economy-lock";
import {
  addPointsInsideUserEconomyLock,
  applyPointsDeltaInsideUserEconomyLock,
} from "../points";

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
  return normalizeUserCards(userData).collectionRewards.includes(getRewardKey(type, albumId));
}

/**
 * Get status of all collection rewards for a user within an album
 */
export async function getAlbumRewardStatuses(userData: UserCards, albumId: string): Promise<RewardStatus[]> {
  const normalizedUserData = normalizeUserCards(userData);
  const rarities: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'legendary_rare'];
  const statuses: RewardStatus[] = [];
  const album = getAlbumById(albumId);
  const albumCards = getCardsByAlbum(albumId);

  // Tier rewards - use album-specific rewards if available, otherwise fall back to global
  for (const rarity of rarities) {
    const rarityCards = albumCards.filter(c => c.rarity === rarity);
    if (rarityCards.length === 0) continue; // Skip if no cards of this rarity in album

    const ownedCount = countOwnedByRarity(normalizedUserData.inventory, rarity, albumId);
    const totalCount = rarityCards.length;
    const eligible = isTierComplete(normalizedUserData.inventory, rarity, albumId);
    const claimed = isRewardClaimed(normalizedUserData, rarity, albumId);

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
  const fullSetEligible = isAlbumComplete(normalizedUserData.inventory, albumId);
  const ownedInAlbum = albumCards.filter(c => normalizedUserData.inventory.includes(c.id)).length;
  const fullSetReward = await getAlbumReward(albumId);

  statuses.push({
    type: 'full_set',
    points: fullSetReward,
    claimed: isRewardClaimed(normalizedUserData, 'full_set', albumId),
    eligible: fullSetEligible,
    ownedCount: ownedInAlbum,
    totalCount: albumCards.length,
  });

  return statuses;
}

/**
 * Claim a collection reward for an album
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
  const numericUserId = Number(userId);

  if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0) {
    return { success: false, message: "无效的用户ID" };
  }

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

  return withUserEconomyLock(userId, async () => {
    const userData = await getUserCardData(userId);

    if (userData.collectionRewards.includes(rewardKey)) {
      return { success: false, message: "该奖励已领取" };
    }

    const inventorySet = new Set(userData.inventory);
    for (const requiredId of requiredCardIds) {
      if (!inventorySet.has(requiredId)) {
        return { success: false, message: "尚未集齐该系列卡牌" };
      }
    }

    const nextUserData: UserCards = {
      ...userData,
      inventory: [...userData.inventory],
      collectionRewards: [...userData.collectionRewards, rewardKey],
    };

    const rarityNames: Record<RewardType, string> = {
      common: '普通',
      rare: '稀有',
      epic: '史诗',
      legendary: '传说',
      legendary_rare: '传说稀有',
      full_set: '全套',
    };

    const description = `集齐${rarityNames[rewardType]}卡牌奖励`;

    let newBalance = 0;
    let pointsGranted = false;
    try {
      const pointsResult = await addPointsInsideUserEconomyLock(
        numericUserId,
        pointsToAward,
        'card_collection',
        description,
      );
      newBalance = pointsResult.balance;
      pointsGranted = true;
      await updateUserCardData(userId, nextUserData);
    } catch (error) {
      if (pointsGranted) {
        try {
          await applyPointsDeltaInsideUserEconomyLock(
            numericUserId,
            -pointsToAward,
            'card_collection',
            `${description}回滚`,
          );
        } catch (rollbackError) {
          console.error("Claim reward points rollback failed:", rollbackError);
        }
      }
      console.error("Claim reward failed:", error);
      return { success: false, message: "奖励发放异常，请稍后重试" };
    }

    return {
      success: true,
      pointsAwarded: pointsToAward,
      newBalance: Math.floor(newBalance),
    };
  });
}
