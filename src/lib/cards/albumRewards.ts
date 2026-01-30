import { kv } from '@vercel/kv';
import { ALBUMS } from './config';
import { COLLECTION_REWARDS } from './constants';
import { Rarity } from './types';

const ALBUM_REWARDS_KEY = 'cards:album_rewards';
const TIER_REWARDS_KEY = 'cards:tier_rewards';

export type RewardTier = Rarity | 'full_set';

/**
 * 获取卡册的实际奖励值（优先使用Redis中的自定义值，否则使用默认值）
 */
export async function getAlbumReward(albumId: string): Promise<number> {
  const album = ALBUMS.find(a => a.id === albumId);
  if (!album) return 0;

  try {
    const customRewards = await kv.get<Record<string, number>>(ALBUM_REWARDS_KEY);
    if (customRewards && typeof customRewards[albumId] === 'number') {
      return customRewards[albumId];
    }
  } catch (error) {
    console.error('Failed to get custom album reward:', error);
  }

  return album.reward;
}

/**
 * 获取所有卡册的奖励值
 */
export async function getAllAlbumRewards(): Promise<Record<string, number>> {
  const rewards: Record<string, number> = {};

  try {
    const customRewards = await kv.get<Record<string, number>>(ALBUM_REWARDS_KEY) || {};

    for (const album of ALBUMS) {
      rewards[album.id] = customRewards[album.id] ?? album.reward;
    }
  } catch (error) {
    console.error('Failed to get album rewards:', error);
    for (const album of ALBUMS) {
      rewards[album.id] = album.reward;
    }
  }

  return rewards;
}

/**
 * 获取稀有度奖励（优先使用Redis中的自定义值）
 */
export async function getTierReward(tier: RewardTier): Promise<number> {
  try {
    const customRewards = await kv.get<Record<string, number>>(TIER_REWARDS_KEY);
    if (customRewards && typeof customRewards[tier] === 'number') {
      return customRewards[tier];
    }
  } catch (error) {
    console.error('Failed to get custom tier reward:', error);
  }
  return COLLECTION_REWARDS[tier];
}

/**
 * 获取所有稀有度奖励
 */
export async function getAllTierRewards(): Promise<Record<RewardTier, number>> {
  const tiers: RewardTier[] = ['common', 'rare', 'epic', 'legendary', 'legendary_rare', 'full_set'];
  const rewards: Record<string, number> = {};

  try {
    const customRewards = await kv.get<Record<string, number>>(TIER_REWARDS_KEY) || {};
    for (const tier of tiers) {
      rewards[tier] = customRewards[tier] ?? COLLECTION_REWARDS[tier];
    }
  } catch (error) {
    console.error('Failed to get tier rewards:', error);
    for (const tier of tiers) {
      rewards[tier] = COLLECTION_REWARDS[tier];
    }
  }

  return rewards as Record<RewardTier, number>;
}

/**
 * 设置稀有度奖励
 */
export async function setTierReward(tier: RewardTier, reward: number): Promise<void> {
  const customRewards = await kv.get<Record<string, number>>(TIER_REWARDS_KEY) || {};
  customRewards[tier] = reward;
  await kv.set(TIER_REWARDS_KEY, customRewards);
}
