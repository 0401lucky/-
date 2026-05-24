// 农场 v1.2 全部配置数据

import type {
  CropIdV2, FertilizerType, Quality, Season, WeatherV2, ShopItemKey, PetType, PetSkill, PetSkillBookKey,
} from '@/lib/types/farm-v2';

export const INITIAL_POINTS = 100;
export const INITIAL_LAND_COUNT = 4;
export const MAX_LAND_COUNT = 8;
export const MAX_EVENTS = 30;

/** 作物配置 */
export interface CropDefV2 {
  id: CropIdV2;
  name: string;
  emoji: string;
  /** 季节限定 */
  seasons: Season[];
  /** 种子价格 */
  seedCost: number;
  /** 基础成长时间（分钟） */
  growthMinutes: number;
  /** 基础浇水间隔（分钟） */
  waterIntervalMinutes: number;
  /** 基础收获积分 */
  baseYield: number;
  /** 解锁需要的土地数 */
  unlockLandCount: number;
}

export const CROPS_V2: Record<CropIdV2, CropDefV2> = {
  wheat:      { id: 'wheat',      name: '小麦',   emoji: '🌾', seasons: ['spring','autumn'],     seedCost: 5,  growthMinutes: 30,  waterIntervalMinutes: 30, baseYield: 12,  unlockLandCount: 4 },
  carrot:     { id: 'carrot',     name: '胡萝卜', emoji: '🥕', seasons: ['spring','autumn'],     seedCost: 8,  growthMinutes: 60,  waterIntervalMinutes: 30, baseYield: 20,  unlockLandCount: 4 },
  lettuce:    { id: 'lettuce',    name: '生菜',   emoji: '🥬', seasons: ['spring'],              seedCost: 10, growthMinutes: 90,  waterIntervalMinutes: 30, baseYield: 28,  unlockLandCount: 4 },
  tomato:     { id: 'tomato',     name: '番茄',   emoji: '🍅', seasons: ['summer'],              seedCost: 18, growthMinutes: 120, waterIntervalMinutes: 40, baseYield: 48,  unlockLandCount: 5 },
  potato:     { id: 'potato',     name: '土豆',   emoji: '🥔', seasons: ['winter','spring'],     seedCost: 20, growthMinutes: 150, waterIntervalMinutes: 60, baseYield: 55,  unlockLandCount: 5 },
  strawberry: { id: 'strawberry', name: '草莓',   emoji: '🍓', seasons: ['spring','summer'],     seedCost: 25, growthMinutes: 180, waterIntervalMinutes: 45, baseYield: 75,  unlockLandCount: 6 },
  corn:       { id: 'corn',       name: '玉米',   emoji: '🌽', seasons: ['summer','autumn'],     seedCost: 35, growthMinutes: 240, waterIntervalMinutes: 60, baseYield: 105, unlockLandCount: 7 },
  pumpkin:    { id: 'pumpkin',    name: '南瓜',   emoji: '🎃', seasons: ['autumn'],              seedCost: 45, growthMinutes: 360, waterIntervalMinutes: 90, baseYield: 150, unlockLandCount: 8 },
};

/** 土地价格表（按 index 1..8） */
export const LAND_UNLOCK_PRICES: Record<number, number> = {
  1: 0, 2: 0, 3: 0, 4: 0, 5: 50, 6: 100, 7: 150, 8: 200,
};

/** 肥料配置 */
export interface FertilizerDef {
  id: Exclude<FertilizerType, null>;
  name: string;
  cost: number;
  /** 成长时间系数 */
  growthFactor: number;
  /** 品质概率：[普通, 银, 金] */
  qualityRates: [number, number, number];
}

export const FERTILIZERS: Record<Exclude<FertilizerType, null>, FertilizerDef> = {
  normal:  { id: 'normal',  name: '普通肥料', cost: 20, growthFactor: 0.90, qualityRates: [0.70, 0.20, 0.10] },
  medium:  { id: 'medium',  name: '中级肥料', cost: 45, growthFactor: 0.80, qualityRates: [0.55, 0.30, 0.15] },
  premium: { id: 'premium', name: '高级肥料', cost: 80, growthFactor: 0.65, qualityRates: [0.40, 0.35, 0.25] },
};

/** 无肥料品质基础概率 [普通, 银, 金] */
export const NO_FERTILIZER_RATES: [number, number, number] = [0.75, 0.20, 0.05];

/** 品质收益倍率 */
export const QUALITY_MULTIPLIERS: Record<Quality, number> = {
  normal: 1.0,
  silver: 1.3,
  gold: 1.8,
};

/** 季节配置 */
export interface SeasonModifierDef {
  growth: number;
  water: number;
  yield: number;
  crow: number;
}

export const SEASON_MODIFIERS: Record<Season, SeasonModifierDef> = {
  spring: { growth: 0.95, water: 1.00, yield: 1.00, crow: 1.00 },
  summer: { growth: 0.90, water: 0.85, yield: 1.00, crow: 1.20 },
  autumn: { growth: 1.00, water: 1.00, yield: 1.10, crow: 1.00 },
  winter: { growth: 1.15, water: 1.20, yield: 1.00, crow: 0.70 },
};

export const SEASON_LABEL: Record<Season, string> = {
  spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季',
};

/** 天气配置 */
export interface WeatherDefV2 {
  id: WeatherV2;
  name: string;
  emoji: string;
  waterFactor: number;
  crowFactor: number;
  /** 自动浇水间隔（分钟），0 表示无 */
  autoWaterMinutes: number;
}

export const WEATHERS_V2: Record<WeatherV2, WeatherDefV2> = {
  sunny:      { id: 'sunny',      name: '晴天', emoji: '☀️', waterFactor: 1.00, crowFactor: 1.00, autoWaterMinutes: 0  },
  cloudy:     { id: 'cloudy',     name: '多云', emoji: '⛅', waterFactor: 1.10, crowFactor: 0.90, autoWaterMinutes: 0  },
  light_rain: { id: 'light_rain', name: '小雨', emoji: '🌦️', waterFactor: 1.00, crowFactor: 0.40, autoWaterMinutes: 30 },
  storm:      { id: 'storm',      name: '暴雨', emoji: '⛈️', waterFactor: 1.00, crowFactor: 0.00, autoWaterMinutes: 15 },
  hot:        { id: 'hot',        name: '炎热', emoji: '🔥', waterFactor: 0.80, crowFactor: 1.20, autoWaterMinutes: 0  },
  wind:       { id: 'wind',       name: '大风', emoji: '🌬️', waterFactor: 1.00, crowFactor: 1.50, autoWaterMinutes: 0  },
  snow:       { id: 'snow',       name: '小雪', emoji: '❄️', waterFactor: 1.20, crowFactor: 0.30, autoWaterMinutes: 0  },
  fog:        { id: 'fog',        name: '雾天', emoji: '🌫️', waterFactor: 1.00, crowFactor: 0.70, autoWaterMinutes: 0  },
};

/** 季节天气概率分布 */
export const SEASON_WEATHER_PROB: Record<Season, Array<[WeatherV2, number]>> = {
  spring: [['sunny',0.30],['cloudy',0.25],['light_rain',0.30],['storm',0.05],['wind',0.10]],
  summer: [['sunny',0.25],['cloudy',0.10],['light_rain',0.20],['storm',0.15],['hot',0.30]],
  autumn: [['sunny',0.40],['cloudy',0.25],['light_rain',0.10],['wind',0.20],['fog',0.05]],
  winter: [['sunny',0.25],['cloudy',0.25],['wind',0.15],['snow',0.30],['fog',0.05]],
};

/** 缺水次数对收益的影响 */
export const WATER_MISS_MUL: Record<number, number> = {
  0: 1.0, 1: 0.8, 2: 0.5, 3: 0,
};

/** 缺水对品质的乘数：[金乘数, 银乘数] */
export const WATER_QUALITY_PENALTY: Record<number, [number, number]> = {
  0: [1.0, 1.0],
  1: [0.5, 0.8],
  2: [0.0, 0.5],
};

/** 完美照顾品质加成：[银加, 金加] */
export const PERFECT_CARE_BONUS: [number, number] = [0.10, 0.05];

/** 过熟阶梯：[小时上限, 系数] */
export const OVERRIPE_TIERS: Array<[number, number]> = [
  [12, 1.0], [24, 0.8], [48, 0.5], [Infinity, 0],
];

/** 乌鸦基础概率 */
export const CROW_BASE_CHANCE = 0.08;
/** 乌鸦判定窗口（毫秒） */
export const CROW_CHECK_WINDOW = 10 * 60 * 1000;
/** 种植后多少时间才进入乌鸦风险 */
export const CROW_INITIAL_DELAY = 10 * 60 * 1000;

/** 防护系数（与 v1.2 表一致） */
export const PROTECTION_FACTORS = {
  none: 1.0,
  scarecrow: 0.40,
  petGuard: 0.50,
  scarecrowAndPet: 0.25,
} as const;

/** 偷菜限制 */
export const STEAL_LIMITS = {
  perCropMaxTimes: 2,
  perCropMaxRatio: 0.30,
  perPlayerDailyMaxBeingStolen: 5,
  perThiefDailyPerTarget: 1,
  catRate: 0.15,
  catLuckyExtra: 0.05,
  catLuckyChance: 0.20,
} as const;

/** 宠物任务表 */
export const PET_ADOPT_COST = 50;

export const PET_TYPE_LABEL: Record<PetType, string> = {
  cat: '小白猫',
  dog: '边牧',
  rabbit: '兔子',
  red_panda: '红熊猫',
};

export const PET_WATER_INTERVAL_MINUTES: Record<PetType, number> = {
  cat: 45,
  dog: 30,
  rabbit: 35,
  red_panda: 40,
};

export const PET_CHASE_SUCCESS_RATE: Record<PetType, number> = {
  cat: 0.65,
  dog: 0.80,
  rabbit: 0.70,
  red_panda: 0.75,
};

export const PET_STEAL_BASE_SUCCESS: Record<PetType, number> = {
  cat: 0.75,
  dog: 0.55,
  rabbit: 0.65,
  red_panda: 0.70,
};

export const PET_GUARD_STEAL_MULTIPLIER: Record<PetType, number> = {
  cat: 0.55,
  dog: 0.30,
  rabbit: 0.45,
  red_panda: 0.40,
};

export interface PetTaskDef {
  durationMinutes: number;
  cooldownMinutes: number;
  catGuardCrowFactor?: number;
  dogGuardCrowFactor?: number;
}

export const PET_TASKS = {
  water:      { durationMinutes: 180, cooldownMinutes: 60 },
  guard:      { durationMinutes: 240, cooldownMinutes: 120, catGuardCrowFactor: 0.70, dogGuardCrowFactor: 0.50 },
  chase_crow: { durationMinutes: 240, cooldownMinutes: 120 },
  steal:      { durationMinutes: 10, cooldownMinutes: 240 },
  harvest:    { durationMinutes: 0, cooldownMinutes: 120 },
  plant:      { durationMinutes: 0, cooldownMinutes: 120 },
} as const satisfies Record<PetSkill, PetTaskDef>;

export const PET_SKILL_LABEL: Record<PetSkill, string> = {
  water: '自动浇水',
  guard: '守护庄园',
  chase_crow: '赶乌鸦',
  steal: '偷菜',
  harvest: '收菜',
  plant: '种菜',
};

export const PET_SKILL_BOOK_TO_SKILL = {
  pet_skill_water: 'water',
  pet_skill_guard: 'guard',
  pet_skill_chase_crow: 'chase_crow',
  pet_skill_steal: 'steal',
  pet_skill_harvest: 'harvest',
  pet_skill_plant: 'plant',
} as const satisfies Partial<Record<ShopItemKey, PetSkill>>;

export const PET_SKILL_BOOK_KEYS = Object.keys(PET_SKILL_BOOK_TO_SKILL) as PetSkillBookKey[];

/** 永久设备类道具：购买后保留在背包，不可重复购买 */
export const ONE_TIME_SHOP_ITEM_KEYS = ['weather_tv'] as const satisfies readonly ShopItemKey[];

/** 宠物每日抚养限制 */
export const PET_DAILY_LIMITS = {
  feedNormal: 3,
  feedPremium: 1,
  wash: 1,
  water: 3,
  toy: 1,
  play: 3,
} as const;

/** 宠物按钮所属类别，用于选择物品弹窗 */
export type PetActionCategory = 'feed' | 'drink' | 'care' | 'rest' | 'play';

/** 物品对宠物各项数值的影响 */
export interface PetItemEffect {
  hunger?: number;
  cleanliness?: number;
  mood?: number;
  thirst?: number; // 正数=口渴值增加（更不渴）；运动消耗则填负数
  health?: number;
  growth?: number;
}

/** 宠物物品配置：按钮类别 + 每日上限 + 数值影响 */
export const PET_ITEM_EFFECTS: Partial<Record<ShopItemKey, { category: PetActionCategory; daily?: keyof typeof PET_DAILY_LIMITS; effect: PetItemEffect }>> = {
  // 喂食
  pet_food_normal:  { category: 'feed',  daily: 'feedNormal',  effect: { hunger: 25, thirst: 4,  mood: 2,  health: 2,  growth: 5  } },
  pet_food_premium: { category: 'feed',  daily: 'feedPremium', effect: { hunger: 45, thirst: 2,  mood: 5,  health: 5,  growth: 12 } },
  // 喂水
  pet_water_basic:  { category: 'drink', effect: { thirst: 35, mood: 2, growth: 1 } },
  pet_milk:         { category: 'drink', effect: { thirst: 45, hunger: 5, mood: 4, growth: 3 } },
  pet_coconut:      { category: 'drink', effect: { thirst: 65, health: 5, mood: 5, growth: 4 } },
  // 保养
  pet_care_basic:   { category: 'care',  effect: { health: 12, mood: 3, growth: 2 } },
  pet_vitamin:      { category: 'care',  effect: { health: 25, mood: 5, growth: 5 } },
  pet_supplement:   { category: 'care',  effect: { health: 45, mood: 8, hunger: 10, growth: 8 } },
  // 休息
  pet_rest_basic:   { category: 'rest',  effect: { cleanliness: 20, mood: 2, growth: 1 } },
  pet_nest:         { category: 'rest',  effect: { cleanliness: 35, mood: 5, health: 3, growth: 4 } },
  pet_blanket:      { category: 'rest',  effect: { cleanliness: 55, mood: 8, health: 5, growth: 6 } },
  pet_wash:         { category: 'rest',  daily: 'wash', effect: { cleanliness: 35, mood: 4, health: 3, growth: 4 } },
  // 陪玩
  pet_play_basic:   { category: 'play',  effect: { mood: 12, health: 4, hunger: -5,  thirst: -6,  cleanliness: -5,  growth: 3 } },
  pet_yarn_ball:    { category: 'play',  effect: { mood: 20, health: 7, hunger: -8,  thirst: -10, cleanliness: -8,  growth: 6 } },
  pet_frisbee:      { category: 'play',  effect: { mood: 30, health: 12, hunger: -12, thirst: -14, cleanliness: -12, growth: 10 } },
  pet_toy:          { category: 'play',  daily: 'toy', effect: { mood: 22, thirst: -5, cleanliness: -4, hunger: -3, health: 4, growth: 8 } },
};

/** 各类别的免费基础物品 key（库存为 0 时仍可使用，但效果较弱） */
export const PET_FREE_FALLBACK: Record<PetActionCategory, ShopItemKey | null> = {
  feed: null, // 喂食必须有物品
  drink: 'pet_water_basic',
  care: 'pet_care_basic',
  rest: 'pet_rest_basic',
  play: 'pet_play_basic',
};

export const PET_FEED_NORMAL = { hunger: 25, thirst: 4, mood: 2, health: 2, growth: 5 };
export const PET_FEED_PREMIUM = { hunger: 45, thirst: 2, mood: 5, health: 5, growth: 12 };
export const PET_WASH = { cleanliness: 35, mood: 4, health: 3, growth: 4 };
export const PET_DRINK = { thirst: 40, mood: 3, health: 4, growth: 2 };
export const PET_PLAY = { mood: 12, hunger: -5, thirst: -6, growth: 3 };
export const PET_TOY = { mood: 22, thirst: -5, growth: 8 };

/** 宠物阶段阈值 */
export const PET_STAGE_THRESHOLD = {
  child: 0,
  adult: 160,
} as const;

/** 宠物每日衰减（口渴值会降低，数值越低越渴） */
export const PET_DAILY_DECAY = { hunger: 14, cleanliness: 10, mood: 8, thirst: 16 };

/** 宠物每小时衰减（用于增量结算） */
export const PET_HOURLY_DECAY = {
  hunger: 0.6,
  cleanliness: 0.45,
  thirst: 0.7,
  moodBase: 0.3,
  moodBadStat: 0.5,
  healthBase: 0.15,
  healthCritical: 0.7,
};

/** 情绪低于该值时宠物会罢工，正在进行的任务直接结束 */
export const PET_MOOD_STOP_WORK = 15;
/** 使用宠物技能最低情绪要求 */
export const PET_MOOD_DISPATCH_MIN = 25;

/** 商店道具 */
export interface ShopItemDef {
  key: ShopItemKey;
  name: string;
  emoji: string;
  category: 'fertilizer' | 'protection' | 'speed' | 'pet' | 'special';
  cost: number;
  description: string;
  /** 持续时间（分钟），用于稻草人/铃铛/防鸟网 */
  durationMinutes?: number;
  /** 每日购买上限 */
  dailyLimit?: number;
}

export const SHOP_ITEMS_V2: Record<ShopItemKey, ShopItemDef> = {
  fert_normal:      { key: 'fert_normal',      name: '普通肥料', emoji: '🌱', category: 'fertilizer', cost: 20,  description: '成长时间 -10%，金星概率 +5%' },
  fert_medium:      { key: 'fert_medium',      name: '中级肥料', emoji: '🌿', category: 'fertilizer', cost: 45,  description: '成长时间 -20%，银星 +10%，金星 +10%' },
  fert_premium:     { key: 'fert_premium',     name: '高级肥料', emoji: '🌳', category: 'fertilizer', cost: 80,  description: '成长时间 -35%，银星 +15%，金星 +20%' },

  scarecrow:        { key: 'scarecrow',        name: '稻草人',   emoji: '👻', category: 'protection', cost: 100, description: '12 小时内全农场乌鸦 ×0.4', durationMinutes: 12 * 60 },
  birdnet:          { key: 'birdnet',          name: '防鸟网',   emoji: '🕸️', category: 'protection', cost: 50,  description: '指定 1 块土地 6 小时免疫乌鸦', durationMinutes: 6 * 60 },
  bell:             { key: 'bell',             name: '看守铃铛', emoji: '🔔', category: 'protection', cost: 80,  description: '6 小时内偷菜成功率 -50%', durationMinutes: 6 * 60 },
  firework:         { key: 'firework',         name: '驱鸟烟花', emoji: '🎆', category: 'protection', cost: 30,  description: '立即驱散当前出现的乌鸦事件' },

  cloud_bottle:     { key: 'cloud_bottle',     name: '云朵瓶',   emoji: '🌧️', category: 'speed', cost: 40, description: '立即给所有未成熟作物浇水' },
  speed_normal:     { key: 'speed_normal',     name: '加速券',   emoji: '⏩', category: 'speed', cost: 30, description: '指定作物剩余成长 -10 分钟' },
  speed_premium:    { key: 'speed_premium',    name: '高级加速', emoji: '🚀', category: 'speed', cost: 70, description: '指定作物剩余成长 -30 分钟' },

  weather_tv:        { key: 'weather_tv',        name: '天气电视机', emoji: '📺', category: 'special', cost: 120, description: '永久解锁电视机按钮，可查看明日天气预报' },

  pet_food_normal:  { key: 'pet_food_normal',  name: '普通宠粮', emoji: '🍖', category: 'pet', cost: 15, description: '饱食明显提升，情绪略微变好，成长 +5', dailyLimit: 3 },
  pet_food_premium: { key: 'pet_food_premium', name: '高级宠粮', emoji: '🥩', category: 'pet', cost: 40, description: '饱食大幅提升，情绪和健康变好，成长 +12', dailyLimit: 1 },

  pet_water_basic:  { key: 'pet_water_basic',  name: '清水',     emoji: '💧', category: 'pet', cost: 0,  description: '免费的基础喂水，口渴值 +35' },
  pet_milk:         { key: 'pet_milk',         name: '牛奶',     emoji: '🥛', category: 'pet', cost: 12, description: '口渴值 +45，并补充少量饱食和情绪' },
  pet_coconut:      { key: 'pet_coconut',      name: '椰子水',   emoji: '🥥', category: 'pet', cost: 25, description: '口渴值 +65，并增加健康和情绪' },

  pet_care_basic:   { key: 'pet_care_basic',   name: '基础体检', emoji: '🩺', category: 'pet', cost: 0,  description: '免费基础保养，健康 +12，情绪 +3' },
  pet_vitamin:      { key: 'pet_vitamin',      name: '维生素',   emoji: '💊', category: 'pet', cost: 30, description: '健康 +25，情绪 +5' },
  pet_supplement:   { key: 'pet_supplement',   name: '营养剂',   emoji: '🧪', category: 'pet', cost: 60, description: '健康 +45，情绪 +8，并补充饱食 +10' },

  pet_rest_basic:   { key: 'pet_rest_basic',   name: '随地休息', emoji: '😴', category: 'pet', cost: 0,  description: '免费休息，体力 +20，情绪 +2' },
  pet_nest:         { key: 'pet_nest',         name: '舒适小窝', emoji: '🛏️', category: 'pet', cost: 25, description: '体力 +35，情绪 +5，健康 +3' },
  pet_blanket:      { key: 'pet_blanket',      name: '柔软毛毯', emoji: '🧣', category: 'pet', cost: 50, description: '体力 +55，情绪 +8，健康 +5' },
  pet_wash:         { key: 'pet_wash',         name: '洗澡券',   emoji: '🛁', category: 'pet', cost: 20, description: '体力 +35，情绪和健康变好，成长 +4', dailyLimit: 1 },

  pet_play_basic:   { key: 'pet_play_basic',   name: '徒手陪玩', emoji: '🤲', category: 'pet', cost: 0,  description: '免费陪玩，情绪 +12、健康 +4，但消耗饱食 -5、体力 -5、口渴值 -6' },
  pet_yarn_ball:    { key: 'pet_yarn_ball',    name: '毛线球',   emoji: '🧶', category: 'pet', cost: 15, description: '情绪 +20、健康 +7，消耗饱食 -8、体力 -8、口渴值 -10' },
  pet_frisbee:      { key: 'pet_frisbee',      name: '飞盘',     emoji: '🥏', category: 'pet', cost: 35, description: '情绪 +30、健康 +12，消耗饱食 -12、体力 -12、口渴值 -14' },
  pet_toy:          { key: 'pet_toy',          name: '玩具球',   emoji: '🎾', category: 'pet', cost: 30, description: '情绪大幅变好，健康 +4，但会降低少量口渴值、消耗体力', dailyLimit: 1 },
  pet_skill_water:      { key: 'pet_skill_water',      name: '自动浇水技能书', emoji: '📘', category: 'pet', cost: 120, description: '成年宠物学习后，可派遣自动浇水 3 小时；同一只宠物同技能只能学习一次' },
  pet_skill_guard:      { key: 'pet_skill_guard',      name: '守护庄园技能书', emoji: '📗', category: 'pet', cost: 140, description: '成年宠物学习后，可守护庄园降低乌鸦和偷菜风险；同一只宠物同技能只能学习一次' },
  pet_skill_chase_crow: { key: 'pet_skill_chase_crow', name: '赶乌鸦技能书',   emoji: '📙', category: 'pet', cost: 130, description: '成年宠物学习后，可主动赶走乌鸦 4 小时；同一只宠物同技能只能学习一次' },
  pet_skill_steal:      { key: 'pet_skill_steal',      name: '偷菜技能书',     emoji: '📕', category: 'pet', cost: 160, description: '成年宠物学习后，可前往好友庄园偷菜；同一只宠物同技能只能学习一次' },
  pet_skill_harvest:    { key: 'pet_skill_harvest',    name: '收菜技能书',     emoji: '📒', category: 'pet', cost: 180, description: '成年宠物学习后，成熟作物会自动收获；同一只宠物同技能只能学习一次' },
  pet_skill_plant:      { key: 'pet_skill_plant',      name: '种菜技能书',     emoji: '📔', category: 'pet', cost: 180, description: '成年宠物学习后，会自动挑选当前季节高收益种子播种空地；同一只宠物同技能只能学习一次' },
  last_supper:      { key: 'last_supper',      name: '最后的晚餐', emoji: '🍽️', category: 'pet', cost: 1000, description: '当前宠物离开庄园，之后可重新领养宠物' },
};

/** 季节锚点：服务运行起点。基于此 epoch 计算季节序号（每周日 0 点中国时区切换） */
export const SEASON_EPOCH_DATE = '2025-01-05'; // 周日，作为春季起点（中国时区）

/** 加速券每轮上限：基础成长时间的 50% */
export const SPEED_MAX_RATIO = 0.5;

/** 引导奖励 */
export const ONBOARDING_BONUS = {
  firstWater: 5,
  firstHarvest: 10,
  firstAdopt: 10,
} as const;

/** 操作冷却（秒） */
export const ACTION_COOLDOWN_SECONDS = 1;
/** 距离缺水还有多久时允许手动浇水，并触发浇水提醒 */
export const WATER_ACTION_LEAD_MS = 10 * 60 * 1000;
