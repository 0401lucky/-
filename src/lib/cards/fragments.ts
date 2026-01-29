import { kv } from "@vercel/kv";
import { CARDS } from "./config";
import { Rarity } from "./types";
import { FRAGMENT_VALUES, EXCHANGE_PRICES } from "./constants";

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
  const userKey = `cards:user:${userId}`;

  // Lua script to atomically handle duplicate detection and fragment conversion
  const luaScript = `
    local userKey = KEYS[1]
    local cardId = ARGV[1]
    local fragmentValue = tonumber(ARGV[2])

    local data = redis.call('GET', userKey)
    local userData
    if data then
        userData = cjson.decode(data)
    else
        userData = { 
            inventory = {}, 
            fragments = 0, 
            pityCounter = 0, 
            drawsAvailable = 10, 
            collectionRewards = {} 
        }
    end

    local isDuplicate = false
    if userData.inventory then
        for _, id in ipairs(userData.inventory) do
            if id == cardId then
                isDuplicate = true
                break
            end
        end
    else
        userData.inventory = {}
    end

    if isDuplicate then
        userData.fragments = (userData.fragments or 0) + fragmentValue
        redis.call('SET', userKey, cjson.encode(userData))
        return {1, fragmentValue}
    else
        table.insert(userData.inventory, cardId)
        redis.call('SET', userKey, cjson.encode(userData))
        return {0, 0}
    end
  `;

  const result = await kv.eval(luaScript, [userKey], [cardId, fragmentValue]) as [number, number];
  const [isDuplicate, fragmentsAdded] = result;

  return {
    isDuplicate: isDuplicate === 1,
    fragmentsAdded
  };
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
  const userKey = `cards:user:${userId}`;

  const luaScript = `
    local userKey = KEYS[1]
    local cardId = ARGV[1]
    local price = tonumber(ARGV[2])

    local data = redis.call('GET', userKey)
    local userData
    if data then
        userData = cjson.decode(data)
    else
        userData = { 
            inventory = {}, 
            fragments = 0, 
            pityCounter = 0, 
            drawsAvailable = 10, 
            collectionRewards = {} 
        }
    end

    if (userData.fragments or 0) < price then
        return {0, userData.fragments or 0, 'insufficient_fragments'}
    end

    userData.fragments = userData.fragments - price
    
    local hasCard = false
    if userData.inventory then
        for _, id in ipairs(userData.inventory) do
            if id == cardId then
                hasCard = true
                break
            end
        end
    else
        userData.inventory = {}
    end

    if not hasCard then
        table.insert(userData.inventory, cardId)
    end

    redis.call('SET', userKey, cjson.encode(userData))
    return {1, userData.fragments, 'ok'}
  `;

  const result = await kv.eval(luaScript, [userKey], [cardId, price]) as [number, number, string];
  const [success, , error] = result;

  if (success === 1) {
    return { success: true };
  } else {
    return { success: false, message: error === 'insufficient_fragments' ? "碎片不足" : "兑换失败" };
  }
}
