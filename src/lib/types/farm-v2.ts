// 开心农场 v1.2 类型定义

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export type WeatherV2 =
  | 'sunny' | 'cloudy' | 'light_rain' | 'storm'
  | 'hot' | 'wind' | 'snow' | 'fog';

export type CropIdV2 =
  | 'wheat' | 'carrot' | 'lettuce' | 'tomato'
  | 'potato' | 'strawberry' | 'corn' | 'pumpkin';

export type FertilizerType = null | 'normal' | 'medium' | 'premium';

export type Quality = 'normal' | 'silver' | 'gold';

export type LandStatus =
  | 'locked' | 'empty' | 'growing' | 'thirsty'
  | 'mature' | 'withered' | 'eaten';

export type CropStageV2 = 'seed' | 'sprout' | 'growing' | 'mature';

export type PetType = 'cat' | 'dog' | 'rabbit' | 'red_panda';
export type PetStage = 'child' | 'adult';
export type PetSkill = 'water' | 'guard' | 'chase_crow' | 'steal' | 'harvest' | 'plant';
export type PetTask = null | PetSkill;

export type ShopItemKey =
  | 'fert_normal' | 'fert_medium' | 'fert_premium'
  | 'scarecrow' | 'birdnet' | 'bell' | 'firework'
  | 'cloud_bottle' | 'speed_normal' | 'speed_premium'
  | 'weather_tv'
  | 'pet_food_normal' | 'pet_food_premium' | 'pet_wash' | 'pet_toy'
  | 'pet_water_basic' | 'pet_milk' | 'pet_coconut'
  | 'pet_care_basic' | 'pet_vitamin' | 'pet_supplement'
  | 'pet_rest_basic' | 'pet_nest' | 'pet_blanket'
  | 'pet_play_basic' | 'pet_yarn_ball' | 'pet_frisbee'
  | 'pet_skill_water' | 'pet_skill_guard' | 'pet_skill_chase_crow'
  | 'pet_skill_steal' | 'pet_skill_harvest' | 'pet_skill_plant'
  | 'last_supper';

export type PetSkillBookKey = Extract<
  ShopItemKey,
  | 'pet_skill_water' | 'pet_skill_guard' | 'pet_skill_chase_crow'
  | 'pet_skill_steal' | 'pet_skill_harvest' | 'pet_skill_plant'
>;

/** 作物实例 */
export interface CropInstance {
  cropId: CropIdV2;
  plantedAt: number;
  matureAt: number;
  lastWaterAt: number;
  nextWaterDueAt: number;
  waterMissCount: number;
  fertilizer: FertilizerType;
  plantedSeason: Season;
  weatherAtPlant: WeatherV2;
  birdNetUntil: number | null;
  stolenAmount: number;
  stolenCount: number;
  /** 已使用过的加速券数量（限单轮 1 次） */
  speedUsed: number;
  /** 累计加速分钟（用于 50% 上限） */
  speedReducedMinutes: number;
}

/** 单块土地 */
export interface LandPlot {
  index: number; // 1..8
  status: LandStatus;
  crop: CropInstance | null;
}

/** 已计算的派生土地（用于前端展示） */
export interface ComputedLand extends LandPlot {
  stage: CropStageV2 | null;
  growthProgress: number; // 0..1
  remainingMs: number;
  nextWaterRemainingMs: number;
  overripeFactor: number;
  expectedQualityHint: Quality | null;
  scarecrowActive: boolean;
  bellActive: boolean;
  netActive: boolean;
}

export interface PetState {
  type: PetType;
  /** 用户给宠物起的名字，旧存档可能没有 */
  name?: string;
  stage: PetStage;
  growth: number;
  hunger: number;
  cleanliness: number;
  mood: number;
  /** 口渴值：0=非常口渴，100=不渴 */
  thirst: number;
  /** 已迁移到新版口渴值语义 */
  hydrationVersion?: 2;
  health: number;
  /** 已学习的宠物技能 */
  learnedSkills?: PetSkill[];
  currentTask: PetTask;
  taskStartAt: number | null;
  taskEndAt: number | null;
  cooldownEndAt: number | null;
  /** 偷菜任务的目标 userId */
  stealTarget?: { userId: number; landIndex: number; cropId: CropIdV2 } | null;
  feedToday: { normal: number; premium: number };
  washToday: number;
  waterToday: number;
  playToday: number;
  toyToday: number;
  dailyResetAt: number;
}

export interface FarmEvent {
  id: string;
  ts: number;
  type:
    | 'mature' | 'wither' | 'crow_eat' | 'crow_chased' | 'stolen_in' | 'stolen_out'
    | 'season_change' | 'weather_change' | 'pet_adopted' | 'pet_grow' | 'pet_task'
    | 'harvest' | 'plant' | 'water_rain' | 'water_pet' | 'land_buy'
    | 'friday_event';
  text: string;
  cropId?: CropIdV2;
  /** 对应土地编号；用于成熟邮件等后台任务确认事件仍然有效 */
  landIndex?: number;
  amount?: number;
}

export interface InventoryItem {
  count: number;
  updatedAt: number;
}

export type Inventory = Partial<Record<ShopItemKey, InventoryItem>>;

export interface FarmStateV2 {
  userId: number;
  /** 福利积分（不再分游戏积分） */
  points: number;
  lands: LandPlot[]; // 长度始终为 8
  scarecrowUntil: number | null;
  bellUntil: number | null;
  pet: PetState | null;
  /** 今日（中国时区）已被偷次数 */
  stolenTodayCount: number;
  /** 今日各偷家偷我次数: thiefId -> count */
  stolenByMap: Record<string, number>;
  /** 我今日偷过的目标: targetId -> count */
  myStealMap: Record<string, number>;
  inventory: Inventory;
  /** 技能书每种限购 1 本 */
  purchasedSkillBooks?: Partial<Record<PetSkillBookKey, boolean>>;
  /** 种子库存：作物 -> 数量 */
  seedInventory: Partial<Record<CropIdV2, number>>;
  events: FarmEvent[];
  /** 上次跨日处理时间（用于宠物衰减/每日偷次数清零） */
  lastDailyResetAt: number;
  /** 上次跨季处理时间（用于换季枯萎） */
  lastSeasonProcessedAt: number;
  /** 上次结算（用于雨天浇水/乌鸦窗口推进） */
  lastTickAt: number;
  /** 上次触发周五随机事件的中国日期 */
  lastFridayEventDate?: string;
  /** 引导奖励：首次浇水/收获/领养发放标记 */
  bonuses: {
    firstWater: boolean;
    firstHarvest: boolean;
    firstAdopt: boolean;
  };
  createdAt: number;
  updatedAt: number;
}

export interface WorldStateV2 {
  date: string; // YYYY-MM-DD（中国时区）
  weather: WeatherV2;
  season: Season;
  generatedAt: number;
}

export interface WeatherForecastV2 {
  /** 明日天气预报（中国时区） */
  tomorrow: WorldStateV2;
}

export interface ProtectionBuffs {
  scarecrowActive: boolean;
  bellActive: boolean;
  petGuarding: boolean; // 自家宠物守护
  petChasing: boolean; // 自家宠物赶乌鸦
}

export interface PlantInput {
  plotIndex: number;
  cropId: CropIdV2;
}

export interface HarvestResult {
  cropId: CropIdV2;
  cropName: string;
  quality: Quality;
  baseYield: number;
  qualityMultiplier: number;
  waterMultiplier: number;
  seasonMultiplier: number;
  overripeMultiplier: number;
  stolenDeduct: number;
  finalYield: number;
  perfect: boolean;
}

export interface FarmStatusResponse {
  state: FarmStateV2;
  computedLands: ComputedLand[];
  world: WorldStateV2;
  /** 天气预报 */
  weatherForecast: WeatherForecastV2;
  serverNow: number;
  /** 当前季节可种作物 */
  plantableCrops: CropIdV2[];
  /** 距离下次换季的毫秒 */
  nextSeasonInMs: number;
  /** 距离下次每日刷新的毫秒 */
  nextDailyInMs: number;
}

/** 偷菜目标候选 */
export interface StealCandidate {
  userId: number;
  nickname: string;
  matureLands: Array<{
    landIndex: number;
    cropId: CropIdV2;
    cropName: string;
    baseYield: number;
  }>;
}
