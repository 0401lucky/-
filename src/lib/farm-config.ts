// src/lib/farm-config.ts - 农场配置表

import type { CropId, CropConfig, FarmLevel, FarmLevelConfig, WeatherConfig, WeatherType } from './types/farm';

// ---- 作物配置 ----

export const CROPS: Record<CropId, CropConfig> = {
  wheat: {
    id: 'wheat',
    name: '小麦',
    icon: '\uD83C\uDF3E',
    seedCost: 10,
    baseYield: 25,
    growthTime: 3 * 60 * 1000,         // 3分钟
    waterInterval: 3 * 60 * 1000,      // 3分钟
    unlockLevel: 1,
    expReward: 5,
    stages: [
      { stage: 'seed', progressStart: 0 },
      { stage: 'sprout', progressStart: 0.2 },
      { stage: 'growing', progressStart: 0.5 },
      { stage: 'mature', progressStart: 1.0 },
    ],
  },
  carrot: {
    id: 'carrot',
    name: '胡萝卜',
    icon: '\uD83E\uDD55',
    seedCost: 20,
    baseYield: 50,
    growthTime: 8 * 60 * 1000,         // 8分钟
    waterInterval: 6 * 60 * 1000,      // 6分钟
    unlockLevel: 1,
    expReward: 10,
    stages: [
      { stage: 'seed', progressStart: 0 },
      { stage: 'sprout', progressStart: 0.2 },
      { stage: 'growing', progressStart: 0.5 },
      { stage: 'mature', progressStart: 1.0 },
    ],
  },
  tomato: {
    id: 'tomato',
    name: '番茄',
    icon: '\uD83C\uDF45',
    seedCost: 35,
    baseYield: 85,
    growthTime: 15 * 60 * 1000,        // 15分钟
    waterInterval: 12 * 60 * 1000,     // 12分钟
    unlockLevel: 2,
    expReward: 18,
    stages: [
      { stage: 'seed', progressStart: 0 },
      { stage: 'sprout', progressStart: 0.15 },
      { stage: 'growing', progressStart: 0.45 },
      { stage: 'mature', progressStart: 1.0 },
    ],
  },
  strawberry: {
    id: 'strawberry',
    name: '草莓',
    icon: '\uD83C\uDF53',
    seedCost: 50,
    baseYield: 120,
    growthTime: 30 * 60 * 1000,        // 30分钟
    waterInterval: 25 * 60 * 1000,     // 25分钟
    unlockLevel: 2,
    expReward: 25,
    stages: [
      { stage: 'seed', progressStart: 0 },
      { stage: 'sprout', progressStart: 0.15 },
      { stage: 'growing', progressStart: 0.45 },
      { stage: 'mature', progressStart: 1.0 },
    ],
  },
  corn: {
    id: 'corn',
    name: '玉米',
    icon: '\uD83C\uDF3D',
    seedCost: 80,
    baseYield: 200,
    growthTime: 60 * 60 * 1000,        // 1小时
    waterInterval: 45 * 60 * 1000,     // 45分钟
    unlockLevel: 3,
    expReward: 40,
    stages: [
      { stage: 'seed', progressStart: 0 },
      { stage: 'sprout', progressStart: 0.1 },
      { stage: 'growing', progressStart: 0.4 },
      { stage: 'mature', progressStart: 1.0 },
    ],
  },
  pumpkin: {
    id: 'pumpkin',
    name: '南瓜',
    icon: '\uD83C\uDF83',
    seedCost: 120,
    baseYield: 300,
    growthTime: 2 * 60 * 60 * 1000,    // 2小时
    waterInterval: 75 * 60 * 1000,     // 75分钟
    unlockLevel: 3,
    expReward: 60,
    stages: [
      { stage: 'seed', progressStart: 0 },
      { stage: 'sprout', progressStart: 0.1 },
      { stage: 'growing', progressStart: 0.4 },
      { stage: 'mature', progressStart: 1.0 },
    ],
  },
  watermelon: {
    id: 'watermelon',
    name: '西瓜',
    icon: '\uD83C\uDF49',
    seedCost: 200,
    baseYield: 480,
    growthTime: 4 * 60 * 60 * 1000,    // 4小时
    waterInterval: 2.5 * 60 * 60 * 1000, // 2.5小时
    unlockLevel: 4,
    expReward: 90,
    stages: [
      { stage: 'seed', progressStart: 0 },
      { stage: 'sprout', progressStart: 0.1 },
      { stage: 'growing', progressStart: 0.35 },
      { stage: 'mature', progressStart: 1.0 },
    ],
  },
  golden_apple: {
    id: 'golden_apple',
    name: '金苹果',
    icon: '\uD83C\uDF4E',
    seedCost: 350,
    baseYield: 800,
    growthTime: 8 * 60 * 60 * 1000,    // 8小时
    waterInterval: 4 * 60 * 60 * 1000, // 4小时
    unlockLevel: 5,
    expReward: 150,
    stages: [
      { stage: 'seed', progressStart: 0 },
      { stage: 'sprout', progressStart: 0.08 },
      { stage: 'growing', progressStart: 0.3 },
      { stage: 'mature', progressStart: 1.0 },
    ],
  },
};

// ---- 等级配置 ----

export const FARM_LEVELS: Record<FarmLevel, FarmLevelConfig> = {
  1: {
    level: 1,
    plotCount: 4,
    expRequired: 0,
    unlockedCrops: ['wheat', 'carrot'],
    title: '新手农夫',
  },
  2: {
    level: 2,
    plotCount: 6,
    expRequired: 100,
    unlockedCrops: ['tomato', 'strawberry'],
    title: '勤劳农夫',
  },
  3: {
    level: 3,
    plotCount: 9,
    expRequired: 400,
    unlockedCrops: ['corn', 'pumpkin'],
    title: '资深农夫',
  },
  4: {
    level: 4,
    plotCount: 12,
    expRequired: 1000,
    unlockedCrops: ['watermelon'],
    title: '农场主',
  },
  5: {
    level: 5,
    plotCount: 16,
    expRequired: 2200,
    unlockedCrops: ['golden_apple'],
    title: '农业大亨',
  },
};

// ---- 天气配置 ----

export const WEATHERS: Record<WeatherType, WeatherConfig> = {
  sunny: {
    type: 'sunny',
    name: '晴天',
    icon: '\u2600\uFE0F',
    probability: 40,
    growthModifier: 1.0,
    yieldModifier: 1.0,
    autoWater: false,
    pestModifier: 1.0,
  },
  rainy: {
    type: 'rainy',
    name: '雨天',
    icon: '\uD83C\uDF27\uFE0F',
    probability: 25,
    growthModifier: 1.3,
    yieldModifier: 1.15,
    autoWater: true,
    pestModifier: 0.5,
  },
  drought: {
    type: 'drought',
    name: '干旱',
    icon: '\uD83C\uDFDC\uFE0F',
    probability: 15,
    growthModifier: 0.7,
    yieldModifier: 0.75,
    autoWater: false,
    pestModifier: 1.2,
  },
  windy: {
    type: 'windy',
    name: '大风',
    icon: '\uD83D\uDCA8',
    probability: 12,
    growthModifier: 0.9,
    yieldModifier: 0.9,
    autoWater: false,
    pestModifier: 0.8,
  },
  foggy: {
    type: 'foggy',
    name: '雾天',
    icon: '\uD83C\uDF2B\uFE0F',
    probability: 8,
    growthModifier: 0.8,
    yieldModifier: 1.05,
    autoWater: false,
    pestModifier: 0.6,
  },
};

// ---- 常量 ----

/** 害虫基础出现概率（每10分钟窗口） */
export const PEST_BASE_CHANCE = 0.08;

/** 害虫检查窗口（毫秒） */
export const PEST_CHECK_WINDOW = 10 * 60 * 1000;

/** 害虫每10分钟的减产比例 */
export const PEST_YIELD_PENALTY_PER_WINDOW = 0.15;

/** 害虫最低产量倍率 */
export const PEST_MIN_YIELD = 0.30;

/** 浇水超时后每周期减产比例 */
export const WATER_MISS_PENALTY = 0.12;

/** 连续错过浇水导致枯萎的周期数 */
export const WATER_MISS_WITHER_THRESHOLD = 5;

/** 操作冷却时间（秒） */
export const ACTION_COOLDOWN_SECONDS = 2;

/** 获取所有作物列表 */
export function getAllCrops(): CropConfig[] {
  return Object.values(CROPS);
}

/** 获取某等级可用的所有作物 */
export function getCropsForLevel(level: FarmLevel): CropConfig[] {
  const allUnlocked: CropId[] = [];
  for (let l = 1; l <= level; l++) {
    allUnlocked.push(...FARM_LEVELS[l as FarmLevel].unlockedCrops);
  }
  return allUnlocked.map(id => CROPS[id]);
}

/** 根据经验计算等级 */
export function getLevelByExp(exp: number): FarmLevel {
  const levels: FarmLevel[] = [5, 4, 3, 2, 1];
  for (const level of levels) {
    if (exp >= FARM_LEVELS[level].expRequired) {
      return level;
    }
  }
  return 1;
}
