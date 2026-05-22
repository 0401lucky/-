import { kv } from '@/lib/d1-kv';
import type { ShopItemKey } from '@/lib/types/farm-v2';
import {
  PET_ITEM_EFFECTS,
  SHOP_ITEMS_V2,
  type PetItemEffect,
  type ShopItemDef,
} from './config';

export interface FarmShopItemOverride {
  key: ShopItemKey;
  cost?: number;
  dailyLimit?: number;
  durationMinutes?: number;
  speedReduceMinutes?: number;
  petEffect?: PetItemEffect;
  updatedAt: number;
}

export type EffectiveFarmShopItem = ShopItemDef & {
  speedReduceMinutes?: number;
  petEffect?: PetItemEffect;
  override?: FarmShopItemOverride;
};

const FARM_SHOP_OVERRIDES_KEY = 'farm:v2:shop:overrides';

function normalizeNumber(value: unknown, min = 0): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < min) return undefined;
  return Math.floor(numberValue);
}

export async function getFarmShopItemOverrides(): Promise<Record<string, FarmShopItemOverride>> {
  const store = kv as typeof kv & {
    hgetall?: <T>(key: string) => Promise<T | null>;
  };
  if (typeof store.hgetall !== 'function') {
    return {};
  }
  const raw = await store.hgetall<Record<string, FarmShopItemOverride>>(FARM_SHOP_OVERRIDES_KEY);
  return raw ?? {};
}

export async function getEffectiveFarmShopItems(): Promise<Record<ShopItemKey, EffectiveFarmShopItem>> {
  const overrides = await getFarmShopItemOverrides();
  const result = {} as Record<ShopItemKey, EffectiveFarmShopItem>;

  for (const [key, base] of Object.entries(SHOP_ITEMS_V2) as Array<[ShopItemKey, ShopItemDef]>) {
    const override = overrides[key];
    result[key] = {
      ...base,
      cost: override?.cost ?? base.cost,
      dailyLimit: override?.dailyLimit ?? base.dailyLimit,
      durationMinutes: override?.durationMinutes ?? base.durationMinutes,
      speedReduceMinutes: override?.speedReduceMinutes,
      petEffect: override?.petEffect,
      override,
    };
  }

  return result;
}

export async function getEffectiveFarmShopItem(key: ShopItemKey): Promise<EffectiveFarmShopItem | null> {
  const items = await getEffectiveFarmShopItems();
  return items[key] ?? null;
}

export async function getEffectivePetItemEffects(): Promise<typeof PET_ITEM_EFFECTS> {
  const items = await getEffectiveFarmShopItems();
  const result = { ...PET_ITEM_EFFECTS };

  for (const [key, item] of Object.entries(items) as Array<[ShopItemKey, EffectiveFarmShopItem]>) {
    if (item.petEffect && result[key]) {
      result[key] = {
        ...result[key]!,
        effect: {
          ...result[key]!.effect,
          ...item.petEffect,
        },
      };
    }
  }

  return result;
}

export async function updateFarmShopItemOverride(
  key: ShopItemKey,
  input: Partial<Omit<FarmShopItemOverride, 'key' | 'updatedAt'>>,
): Promise<FarmShopItemOverride> {
  if (!SHOP_ITEMS_V2[key]) {
    throw new Error('未知农场商品');
  }

  const existing = (await kv.hget<FarmShopItemOverride>(FARM_SHOP_OVERRIDES_KEY, key)) ?? {
    key,
    updatedAt: Date.now(),
  };

  const next: FarmShopItemOverride = {
    key,
    updatedAt: Date.now(),
  };

  const cost = normalizeNumber(input.cost, 0);
  if (cost !== undefined) next.cost = cost;

  const dailyLimit = normalizeNumber(input.dailyLimit, 0);
  if (dailyLimit !== undefined) next.dailyLimit = dailyLimit;

  const durationMinutes = normalizeNumber(input.durationMinutes, 1);
  if (durationMinutes !== undefined) next.durationMinutes = durationMinutes;

  const speedReduceMinutes = normalizeNumber(input.speedReduceMinutes, 1);
  if (speedReduceMinutes !== undefined) next.speedReduceMinutes = speedReduceMinutes;

  if (input.petEffect && typeof input.petEffect === 'object') {
    const petEffect: PetItemEffect = {};
    for (const keyName of ['hunger', 'cleanliness', 'mood', 'thirst', 'health', 'growth'] as const) {
      const value = Number(input.petEffect[keyName]);
      if (Number.isFinite(value)) petEffect[keyName] = value;
    }
    if (Object.keys(petEffect).length > 0) next.petEffect = petEffect;
  }

  const merged = { ...existing, ...next };
  await kv.hset(FARM_SHOP_OVERRIDES_KEY, { [key]: merged });
  return merged;
}
