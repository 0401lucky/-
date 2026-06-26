import type { Rarity } from './types';

export interface RecentDraw {
  cardId: string;
  rarity: Rarity;
  isDuplicate: boolean;
  fragmentsAdded: number;
  timestamp: number;
}

export interface UserCards {
  inventory: string[];
  fragments: number;
  pityCounter: number;
  pityRare?: number;
  pityEpic?: number;
  pityLegendary?: number;
  pityLegendaryRare?: number;
  drawsAvailable: number;
  collectionRewards: string[];
  recentDraws?: RecentDraw[];
}
