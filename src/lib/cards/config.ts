import type { CardConfig, Rarity } from "./types";
import { getCardImagePath, RARITY_CARD_BACKS, RARITY_PROBABILITIES } from "./constants";

const createCard = (name: string, rarity: Rarity): CardConfig => ({
  id: `${rarity}-${name}`,
  name,
  rarity,
  image: getCardImagePath(name),
  backImage: RARITY_CARD_BACKS[rarity],
  probability: RARITY_PROBABILITIES[rarity],
});

const legendaryRareCards = ["熊猫", "鲸鱼"] as const;
const legendaryCards = ["小熊猫", "狐狸", "梅花鹿"] as const;
const epicCards = ["水獭", "海豹", "考拉", "羊驼", "小老虎"] as const;
const rareCards = ["柴犬", "垂耳兔", "企鹅", "海龟", "章鱼"] as const;
const commonCards = ["仓鼠", "河豚", "水母", "蝾螈", "魔鬼鱼"] as const;

export const CARDS: CardConfig[] = [
  ...legendaryRareCards.map((name) => createCard(name, "legendary_rare")),
  ...legendaryCards.map((name) => createCard(name, "legendary")),
  ...epicCards.map((name) => createCard(name, "epic")),
  ...rareCards.map((name) => createCard(name, "rare")),
  ...commonCards.map((name) => createCard(name, "common")),
];
