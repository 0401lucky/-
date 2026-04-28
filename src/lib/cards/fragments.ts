import { CARDS } from "./config";
import { Rarity } from "./types";
import { FRAGMENT_VALUES, EXCHANGE_PRICES } from "./constants";
import { getUserCardData, updateUserCardData } from "./draw";

/**
 * Returns the fragment value for a given rarity when a duplicate card is obtained.
 */
export function getFragmentValue(rarity: Rarity): number {
  return FRAGMENT_VALUES[rarity];
}

/**
 * Returns the exchange price for a given rarity.
 */
export function getExchangePrice(rarity: Rarity): number {
  return EXCHANGE_PRICES[rarity];
}

/**
 * Handles a card acquisition. If the user already owns the card, it converts to fragments.
 * Otherwise, it adds the card to the user's inventory.
 * Uses a Lua script for atomicity.
 */
export async function handleDuplicateCard(userId: string, cardId: string): Promise<{ isDuplicate: boolean; fragmentsAdded: number }> {
  const card = CARDS.find(c => c.id === cardId);
  if (!card) throw new Error("Invalid card ID");

  const fragmentValue = getFragmentValue(card.rarity);
  const userData = await getUserCardData(userId);

  const isDuplicate = userData.inventory.includes(cardId);

  if (isDuplicate) {
    userData.fragments = (userData.fragments ?? 0) + fragmentValue;
    await updateUserCardData(userId, userData);
    return { isDuplicate: true, fragmentsAdded: fragmentValue };
  }

  userData.inventory.push(cardId);
  await updateUserCardData(userId, userData);
  return { isDuplicate: false, fragmentsAdded: 0 };
}

/**
 * Exchanges fragments for a specific card.
 * Deducts fragments and adds the card to inventory if the user has enough fragments.
 * Uses a Lua script for atomicity.
 */
export async function exchangeFragmentsForCard(userId: string, cardId: string): Promise<{ success: boolean; message?: string }> {
  const card = CARDS.find(c => c.id === cardId);
  if (!card) {
    return { success: false, message: "无效的卡片 ID" };
  }

  const price = getExchangePrice(card.rarity);
  const userData = await getUserCardData(userId);

  const hasCard = userData.inventory.includes(cardId);
  if (hasCard) {
    return { success: false, message: "已拥有该卡片，无需兑换" };
  }

  if ((userData.fragments ?? 0) < price) {
    return { success: false, message: "碎片不足" };
  }

  userData.fragments = (userData.fragments ?? 0) - price;
  userData.inventory.push(cardId);
  await updateUserCardData(userId, userData);
  return { success: true };
}
