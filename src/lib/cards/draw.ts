import { kv } from "@vercel/kv";
import { CARDS } from "./config";
import { CardConfig, Rarity } from "./types";
import { RARITY_PROBABILITIES } from "./constants";

export interface UserCards {
  inventory: string[];
  fragments: number;
  pityCounter: number;
  drawsAvailable: number;
  collectionRewards: string[];
}

const DEFAULT_USER_CARDS: UserCards = {
  inventory: [],
  fragments: 0,
  pityCounter: 0,
  drawsAvailable: 10,
  collectionRewards: [],
};

export async function getUserCardData(userId: string): Promise<UserCards> {
  const data = await kv.get<UserCards>(`cards:user:${userId}`);
  return data || { ...DEFAULT_USER_CARDS };
}

export async function updateUserCardData(userId: string, data: UserCards): Promise<void> {
  await kv.set(`cards:user:${userId}`, data);
}

/**
 * Selects a card based on probability weights.
 * First selects a rarity tier based on RARITY_PROBABILITIES,
 * then selects a random card within that tier.
 */
export function selectCardByProbability(): CardConfig {
  const rarities = Object.keys(RARITY_PROBABILITIES) as Rarity[];
  const totalWeight = rarities.reduce((sum, r) => sum + RARITY_PROBABILITIES[r], 0);
  
  let random = Math.random() * totalWeight;
  let selectedRarity: Rarity = 'common';

  for (const rarity of rarities) {
    random -= RARITY_PROBABILITIES[rarity];
    if (random <= 0) {
      selectedRarity = rarity;
      break;
    }
  }

  const cardsInRarity = CARDS.filter(c => c.rarity === selectedRarity);
  
  // Fallback if no cards in rarity (should not happen with correct config)
  if (cardsInRarity.length === 0) {
    return CARDS[CARDS.length - 1];
  }

  return cardsInRarity[Math.floor(Math.random() * cardsInRarity.length)];
}

/**
 * Main draw function.
 * Handles draw availability, card selection, and user data persistence.
 */
export async function drawCard(userId: string): Promise<{ success: boolean; card?: CardConfig; message?: string }> {
  const userData = await getUserCardData(userId);

  if (userData.drawsAvailable <= 0) {
    return { success: false, message: "抽卡次数不足" };
  }

  const card = selectCardByProbability();

  // Update user data
  userData.drawsAvailable -= 1;
  userData.inventory.push(card.id);
  
  // Note: Pity and fragments are handled in future tasks
  
  await updateUserCardData(userId, userData);

  return { success: true, card };
}
