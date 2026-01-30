import { kv } from '@vercel/kv';
import { ALBUMS } from './config';

const ALBUM_REWARDS_KEY = 'cards:album_rewards';

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
