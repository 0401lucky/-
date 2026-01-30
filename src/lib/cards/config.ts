import type { CardConfig, CardAlbum, Rarity } from "./types";
import { getCardImagePath, RARITY_CARD_BACKS, RARITY_PROBABILITIES } from "./constants";

// Card Albums Definition
export const ALBUMS: CardAlbum[] = [
  {
    id: "animal-s1",
    name: "动物伙伴图鉴",
    description: "收集可爱的动物卡牌，解锁专属奖励",
    coverImage: "/images/动物卡/熊猫.png",
    reward: 10000,
    season: "第一季",
  },
];

const createCard = (name: string, rarity: Rarity, albumId: string): CardConfig => ({
  id: `${rarity}-${name}`,
  name,
  rarity,
  image: getCardImagePath(name),
  backImage: RARITY_CARD_BACKS[rarity],
  probability: RARITY_PROBABILITIES[rarity],
  albumId,
});

// Animal Album S1 Cards
const animalS1AlbumId = "animal-s1";

const legendaryRareCards = ["熊猫", "鲸鱼"] as const;
const legendaryCards = ["小熊猫", "狐狸", "梅花鹿"] as const;
const epicCards = ["水獭", "海豹", "考拉", "羊驼", "小老虎"] as const;
const rareCards = ["柴犬", "垂耳兔", "企鹅", "海龟", "章鱼"] as const;
const commonCards = ["仓鼠", "河豚", "水母", "蝾螈", "魔鬼鱼"] as const;

export const CARDS: CardConfig[] = [
  ...legendaryRareCards.map((name) => createCard(name, "legendary_rare", animalS1AlbumId)),
  ...legendaryCards.map((name) => createCard(name, "legendary", animalS1AlbumId)),
  ...epicCards.map((name) => createCard(name, "epic", animalS1AlbumId)),
  ...rareCards.map((name) => createCard(name, "rare", animalS1AlbumId)),
  ...commonCards.map((name) => createCard(name, "common", animalS1AlbumId)),
];

// Helper functions
export function getAlbumById(albumId: string): CardAlbum | undefined {
  return ALBUMS.find(a => a.id === albumId);
}

export function getCardsByAlbum(albumId: string): CardConfig[] {
  return CARDS.filter(c => c.albumId === albumId);
}

export function getAllAlbumIds(): string[] {
  return ALBUMS.map(a => a.id);
}
