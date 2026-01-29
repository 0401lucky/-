export type Rarity = 'legendary_rare' | 'legendary' | 'epic' | 'rare' | 'common';

export interface CardConfig {
  id: string;
  name: string;
  rarity: Rarity;
  image: string;       // Path to front image
  backImage: string;   // Path to back image (rarity based)
  probability: number; // Probability weight (0-100)
}

export interface UserCardData {
  cardId: string;
  count: number;
  isNew: boolean;
  updatedAt: number;
}
