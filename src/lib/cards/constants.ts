import type { Rarity } from "./types";

export const CARD_IMAGE_BASE_PATH = "/images/动物卡";
export const CARD_BACK_BASE_PATH = "/images/通用1";

export const RARITY_PROBABILITIES: Record<Rarity, number> = {
  legendary_rare: 0.5,
  legendary: 2,
  epic: 7,
  rare: 25,
  common: 65.5,
};

export const RARITY_CARD_BACKS: Record<Rarity, string> = {
  legendary_rare: `${CARD_BACK_BASE_PATH}/第一等级-传说稀有.png`,
  legendary: `${CARD_BACK_BASE_PATH}/第二高等级-传说.png`,
  epic: `${CARD_BACK_BASE_PATH}/第三等等级-史诗.png`,
  rare: `${CARD_BACK_BASE_PATH}/第四等等级-稀有.png`,
  common: `${CARD_BACK_BASE_PATH}/第五等等级-普通.png`,
};

export const PITY_THRESHOLDS = {
  rare: 10,
  epic: 50,
  legendary: 100,
  legendary_rare: 200,
} as const;

export const FRAGMENT_VALUES: Record<Rarity, number> = {
  common: 3,
  rare: 8,
  epic: 20,
  legendary: 50,
  legendary_rare: 100,
};

export const EXCHANGE_PRICES: Record<Rarity, number> = {
  common: 30,
  rare: 80,
  epic: 200,
  legendary: 500,
  legendary_rare: 1000,
};

export const getCardImagePath = (name: string) => `${CARD_IMAGE_BASE_PATH}/${name}.png`;
