export type Rarity = 'legendary_rare' | 'legendary' | 'epic' | 'rare' | 'common';

export interface CardConfig {
  id: string;
  name: string;
  rarity: Rarity;
  image: string;       // Path to front image
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
