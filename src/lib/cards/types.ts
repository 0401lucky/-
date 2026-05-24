export type Rarity = 'legendary_rare' | 'legendary' | 'epic' | 'rare' | 'common';

export interface CardConfig {
  id: string;
  name: string;
  rarity: Rarity;
  image: string;       // 高清优化卡面图
  thumbnailImage?: string; // 列表、封面、记录等小尺寸场景使用的轻量图
  originalImage?: string;  // 原始卡面图，保留作回退或后续高保真用途
  backImage: string;   // Path to back image (rarity based)
  probability: number; // Probability weight (0-100)
  albumId: string;     // Which album this card belongs to
}

export type TierRewards = Record<Rarity, number>;

export interface CardAlbum {
  id: string;
  name: string;
  description: string;
  coverImage: string;
  reward: number;       // Points reward for completing this album
  season?: string;      // Optional season label
  tierRewards?: TierRewards; // Optional per-album tier rewards
}

export interface UserCardData {
  cardId: string;
  count: number;
  isNew: boolean;
  updatedAt: number;
}
