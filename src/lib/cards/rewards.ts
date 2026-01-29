import { CARDS } from "./config";
import { COLLECTION_REWARDS } from "./constants";
import { Rarity } from "./types";
import { getUserCardData, updateUserCardData, UserCards } from "./draw";
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
 */
export async function claimCollectionReward(
  userId: string,
  rewardType: RewardType
): Promise<ClaimResult> {
  const userData = await getUserCardData(userId);

  // Check if already claimed
  if (isRewardClaimed(userData, rewardType)) {
    return { success: false, message: "该奖励已领取" };
  }

  // Check eligibility
  let eligible = false;
  if (rewardType === 'full_set') {
    eligible = isFullCollectionComplete(userData.inventory);
  } else {
    eligible = isTierComplete(userData.inventory, rewardType);
  }

  if (!eligible) {
    return { success: false, message: "尚未集齐该系列卡牌" };
  }

  // Get reward points
  const points = COLLECTION_REWARDS[rewardType];

  // Mark as claimed
  userData.collectionRewards.push(getRewardKey(rewardType));
  await updateUserCardData(userId, userData);

  // Award points
  const rarityNames: Record<RewardType, string> = {
    common: '普通',
    rare: '稀有',
    epic: '史诗',
    legendary: '传说',
    legendary_rare: '传说稀有',
    full_set: '全套',
  };

  const description = `集齐${rarityNames[rewardType]}卡牌奖励`;
  const result = await addPoints(Number(userId), points, 'card_collection', description);

  return {
    success: true,
    pointsAwarded: points,
    newBalance: result.balance,
  };
}
