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
  {
    id: "animal-s2",
    name: "动物伙伴图鉴 II",
    description: "更多可爱动物等你收集，全新冒险开启",
    coverImage: "/images/动物2/传说稀有/哈士奇.png",
    reward: 20000,
    season: "第二季",
  },
];

const createCard = (name: string, rarity: Rarity, albumId: string, imagePath?: string): CardConfig => ({
  id: `${albumId}-${rarity}-${name}`,
  name,
  rarity,
  image: imagePath || getCardImagePath(name),
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

const animalS1Cards: CardConfig[] = [
  ...legendaryRareCards.map((name) => createCard(name, "legendary_rare", animalS1AlbumId)),
  ...legendaryCards.map((name) => createCard(name, "legendary", animalS1AlbumId)),
  ...epicCards.map((name) => createCard(name, "epic", animalS1AlbumId)),
  ...rareCards.map((name) => createCard(name, "rare", animalS1AlbumId)),
  ...commonCards.map((name) => createCard(name, "common", animalS1AlbumId)),
];

// Animal Album S2 Cards
const animalS2AlbumId = "animal-s2";
const animalS2BasePath = "/images/动物2";

const s2LegendaryRareCards = ["哈士奇", "三花猫", "小狮子"] as const;
const s2LegendaryCards = ["北极熊", "熊峰", "猫头鹰"] as const;
const s2EpicCards = ["刺猬", "狐猴", "火烈鸟", "小松鼠", "小棕熊"] as const;
const s2RareCards = ["布偶猫", "黑猫", "加菲猫", "金毛", "柯基", "绵阳", "奶牛", "青蛙", "萨摩耶", "小猴子", "小毛驴", "鹦鹉"] as const;
const s2CommonCards = ["斑马", "蝙蝠", "变色龙", "法斗", "河马", "獾", "树懒", "暹罗猫", "小浣熊", "小鸡", "小马", "小象", "小猪", "雪纳瑞", "野猪", "长颈鹿"] as const;

const getS2ImagePath = (name: string, rarity: Rarity) => {
  const rarityFolders: Record<Rarity, string> = {
    legendary_rare: "传说稀有",
    legendary: "传说",
    epic: "史诗",
    rare: "稀有",
    common: "普通",
  };
  return `${animalS2BasePath}/${rarityFolders[rarity]}/${name}.png`;
};

const animalS2Cards: CardConfig[] = [
  ...s2LegendaryRareCards.map((name) => createCard(name, "legendary_rare", animalS2AlbumId, getS2ImagePath(name, "legendary_rare"))),
  ...s2LegendaryCards.map((name) => createCard(name, "legendary", animalS2AlbumId, getS2ImagePath(name, "legendary"))),
  ...s2EpicCards.map((name) => createCard(name, "epic", animalS2AlbumId, getS2ImagePath(name, "epic"))),
  ...s2RareCards.map((name) => createCard(name, "rare", animalS2AlbumId, getS2ImagePath(name, "rare"))),
  ...s2CommonCards.map((name) => createCard(name, "common", animalS2AlbumId, getS2ImagePath(name, "common"))),
];

export const CARDS: CardConfig[] = [...animalS1Cards, ...animalS2Cards];

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
