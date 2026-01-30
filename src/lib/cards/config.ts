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
    tierRewards: {
      common: 400,
      rare: 650,
      epic: 1200,
      legendary: 1800,
      legendary_rare: 3500,
    },
  },
  {
    id: "animal-s2",
    name: "动物伙伴图鉴 II",
    description: "更多可爱动物等你收集，全新冒险开启",
    coverImage: "/images/动物2/传说稀有/哈士奇.png",
    reward: 20000,
    season: "第二季",
    tierRewards: {
      common: 600,
      rare: 1000,
      epic: 1800,
      legendary: 2700,
      legendary_rare: 5000,
    },
  },
  {
    id: "tarot",
    name: "神秘塔罗牌",
    description: "收集78张经典塔罗牌，揭示命运的奥秘",
    coverImage: "/images/塔罗/传说稀有/0-The Fool-愚者.png",
    reward: 50000,
    season: "特别篇",
    tierRewards: {
      common: 1000,
      rare: 1600,
      epic: 3000,
      legendary: 4500,
      legendary_rare: 8500,
    },
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

// Tarot Album Cards
const tarotAlbumId = "tarot";
const tarotBasePath = "/images/塔罗";

// 塔罗牌文件名格式: "数字-英文名-中文名.png"
const tarotCards: { name: string; file: string }[] = [
  // 传说稀有 (5张)
  { name: "愚者", file: "0-The Fool-愚者.png" },
  { name: "世界", file: "21-The World-世界.png" },
  { name: "权杖三", file: "24-Three of Wands-权杖三.png" },
  { name: "圣杯三", file: "38-Three of Cups-圣杯三.png" },
  { name: "星币皇后", file: "76-Queen of Pentacles-星币皇后.png" },
];

const tarotLegendaryCards: { name: string; file: string }[] = [
  // 传说 (7张)
  { name: "星星", file: "17-The Star-星星.png" },
  { name: "月亮", file: "18-The Moon-月亮.png" },
  { name: "太阳", file: "19-The Sun-太阳.png" },
  { name: "圣杯四", file: "39-Four of Cups-圣杯四.png" },
  { name: "宝剑四", file: "53-Four of Swords-宝剑四.png" },
  { name: "宝剑八", file: "57-Eight of Swords-宝剑八.png" },
  { name: "力量", file: "8-Strength-力量.png" },
];

const tarotEpicCards: { name: string; file: string }[] = [
  // 史诗 (15张)
  { name: "节制", file: "14-Temperance-节制.png" },
  { name: "高塔", file: "16-The Tower-高塔.png" },
  { name: "魔术师", file: "1-The Magician-魔术师.png" },
  { name: "审判", file: "20-Judgment-审判.png" },
  { name: "权杖二", file: "23-Two of Wands-权杖二.png" },
  { name: "权杖四", file: "25-Four of Wands-权杖四.png" },
  { name: "权杖十", file: "31-Ten of Wands-权杖十.png" },
  { name: "圣杯六", file: "41-Six of Cups-圣杯六.png" },
  { name: "圣杯侍从", file: "46-Page of Cups-圣杯侍从.png" },
  { name: "圣杯骑士", file: "47-Knight of Cups-圣杯骑士.png" },
  { name: "圣杯皇后", file: "48-Queen of Cups-圣杯皇后.png" },
  { name: "星币一", file: "64-Ace of Pentacles-星币一.png" },
  { name: "恋人", file: "6-The Lovers-恋人.png" },
  { name: "星币七", file: "70-Seven of Pentacles-星币七.png" },
  { name: "星币国王", file: "77-King of Pentacles-星币国王.png" },
];

const tarotRareCards: { name: string; file: string }[] = [
  // 稀有 (25张)
  { name: "倒吊人", file: "12-The Hanged Man-倒吊人.png" },
  { name: "恶魔", file: "15-The Devil-恶魔.png" },
  { name: "权杖一", file: "22-Ace of Wands-权杖一.png" },
  { name: "权杖五", file: "26-Five of Wands-权杖五.png" },
  { name: "权杖九", file: "30-Nine of Wands-权杖九.png" },
  { name: "权杖侍从", file: "32-Page of Wands-权杖侍从.png" },
  { name: "权杖骑士", file: "33-Knight of Wands-权杖骑士.png" },
  { name: "权杖国王", file: "35-King of Wands-权杖国王.png" },
  { name: "圣杯一", file: "36-Ace of Cups-圣杯一.png" },
  { name: "圣杯五", file: "40-Five of Cups-圣杯五.png" },
  { name: "宝剑九", file: "58-Nine of Swords-宝剑九.png" },
  { name: "宝剑十", file: "59-Ten of Swords-宝剑十.png" },
  { name: "教皇", file: "5-The Hierophant-教皇.png" },
  { name: "宝剑侍从", file: "60-Page of Swords-宝剑侍从.png" },
  { name: "宝剑骑士", file: "61-Knight of Swords-宝剑骑士.png" },
  { name: "宝剑皇后", file: "62-Queen of Swords-宝剑皇后.png" },
  { name: "宝剑国王", file: "63-King of Swords-宝剑国王.png" },
  { name: "星币二", file: "65-Two of Pentacles-星币二.png" },
  { name: "星币四", file: "67-Four of Pentacles-星币四.png" },
  { name: "星币五", file: "68-Five of Pentacles-星币五.png" },
  { name: "星币六", file: "69-Six of Pentacles-星币六.png" },
  { name: "星币八", file: "71-Eight of Pentacles-星币八.png" },
  { name: "星币十", file: "73-Ten of Pentacles-星币十.png" },
  { name: "星币侍从", file: "74-Page of Pentacles-星币侍从.png" },
  { name: "战车", file: "7-The Chariot-战车.png" },
];

const tarotCommonCards: { name: string; file: string }[] = [
  // 普通 (26张)
  { name: "命运之轮", file: "10-Wheel of Fortune-命运之轮.png" },
  { name: "正义", file: "11-Justice-正义.png" },
  { name: "死神", file: "13-Death-死神.png" },
  { name: "权杖六", file: "27-Six of Wands-权杖六.png" },
  { name: "权杖七", file: "28-Seven of Wands-权杖七.png" },
  { name: "权杖八", file: "29-Eight of Wands-权杖八.png" },
  { name: "女祭司", file: "2-The High Priestess-女祭司.png" },
  { name: "权杖皇后", file: "34-Queen of Wands-权杖皇后.png" },
  { name: "圣杯二", file: "37-Two of Cups-圣杯二.png" },
  { name: "皇后", file: "3-The Empress-皇后.png" },
  { name: "圣杯七", file: "42-Seven of Cups-圣杯七.png" },
  { name: "圣杯八", file: "43-Eight of Cups-圣杯八.png" },
  { name: "圣杯九", file: "44-Nine of Cups-圣杯九.png" },
  { name: "圣杯十", file: "45-Ten of Cups-圣杯十.png" },
  { name: "圣杯国王", file: "49-King of Cups-圣杯国王.png" },
  { name: "皇帝", file: "4-The Emperor-皇帝.png" },
  { name: "宝剑一", file: "50-Ace of Swords-宝剑一.png" },
  { name: "宝剑二", file: "51-Two of Swords-宝剑二.png" },
  { name: "宝剑三", file: "52-Three of Swords-宝剑三.png" },
  { name: "宝剑五", file: "54-Five of Swords-宝剑五.png" },
  { name: "宝剑六", file: "55-Six of Swords-宝剑六.png" },
  { name: "宝剑七", file: "56-Seven of Swords-宝剑七.png" },
  { name: "星币三", file: "66-Three of Pentacles-星币三.png" },
  { name: "星币九", file: "72-Nine of Pentacles-星币九.png" },
  { name: "星币骑士", file: "75-Knight of Pentacles-星币骑士.png" },
  { name: "隐士", file: "9-The Hermit-隐士.png" },
];

const getTarotImagePath = (file: string, rarity: Rarity) => {
  const rarityFolders: Record<Rarity, string> = {
    legendary_rare: "传说稀有",
    legendary: "传说",
    epic: "史诗",
    rare: "稀有",
    common: "普通",
  };
  return `${tarotBasePath}/${rarityFolders[rarity]}/${file}`;
};

const tarotAllCards: CardConfig[] = [
  ...tarotCards.map((c) => createCard(c.name, "legendary_rare", tarotAlbumId, getTarotImagePath(c.file, "legendary_rare"))),
  ...tarotLegendaryCards.map((c) => createCard(c.name, "legendary", tarotAlbumId, getTarotImagePath(c.file, "legendary"))),
  ...tarotEpicCards.map((c) => createCard(c.name, "epic", tarotAlbumId, getTarotImagePath(c.file, "epic"))),
  ...tarotRareCards.map((c) => createCard(c.name, "rare", tarotAlbumId, getTarotImagePath(c.file, "rare"))),
  ...tarotCommonCards.map((c) => createCard(c.name, "common", tarotAlbumId, getTarotImagePath(c.file, "common"))),
];

export const CARDS: CardConfig[] = [...animalS1Cards, ...animalS2Cards, ...tarotAllCards];

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
