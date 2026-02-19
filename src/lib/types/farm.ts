// src/lib/types/farm.ts - 农场游戏类型定义

/** 作物ID */
export type CropId = 'wheat' | 'carrot' | 'tomato' | 'strawberry' | 'corn' | 'pumpkin' | 'watermelon' | 'golden_apple';

/** 作物生长阶段 */
export type CropStage = 'seed' | 'sprout' | 'growing' | 'mature' | 'withered';

/** 天气类型 */
export type WeatherType = 'sunny' | 'rainy' | 'drought' | 'windy' | 'foggy';

/** 农场等级 1-5 */
export type FarmLevel = 1 | 2 | 3 | 4 | 5;

/** 单块田地状态 */
export interface PlotState {
  index: number;
  cropId: CropId | null;
  plantedAt: number | null;       // 种植时间戳
  lastWateredAt: number | null;   // 最后浇水时间戳
  waterCount: number;             // 累计浇水次数
  hasPest: boolean;               // 是否有害虫
  pestAppearedAt: number | null;  // 害虫出现时间
  pestClearedAt: number | null;   // 最近一次除虫时间
  stage: CropStage;               // 当前阶段（惰性计算后的快照）
  yieldMultiplier: number;        // 产量倍率（受浇水/害虫/天气影响）
}

/** 农场完整状态 */
export interface FarmState {
  userId: number;
  level: FarmLevel;
  exp: number;
  plots: PlotState[];
  unlockedCrops: CropId[];
  totalHarvests: number;
  totalEarnings: number;
  lastUpdatedAt: number;
  createdAt: number;
}

/** 作物配置 */
export interface CropConfig {
  id: CropId;
  name: string;
  icon: string;
  seedCost: number;          // 种子价格
  baseYield: number;         // 基础产出积分
  growthTime: number;        // 总生长时间(ms)
  waterInterval: number;     // 浇水间隔(ms)
  unlockLevel: FarmLevel;    // 解锁等级
  expReward: number;         // 收获获得经验
  stages: CropStageConfig[]; // 阶段时间配置
}

/** 阶段时间配置（生长进度百分比） */
export interface CropStageConfig {
  stage: CropStage;
  progressStart: number;  // 该阶段开始时的进度 (0~1)
}

/** 等级配置 */
export interface FarmLevelConfig {
  level: FarmLevel;
  plotCount: number;
  expRequired: number;     // 累计经验
  unlockedCrops: CropId[];
  title: string;
}

/** 天气配置 */
export interface WeatherConfig {
  type: WeatherType;
  name: string;
  icon: string;
  probability: number;     // 概率权重
  growthModifier: number;  // 生长速度倍率
  yieldModifier: number;   // 产量倍率
  autoWater: boolean;      // 是否自动浇水
  pestModifier: number;    // 害虫概率倍率
}

/** 计算后的田地展示状态（前端使用） */
export interface ComputedPlotState extends PlotState {
  growthProgress: number;      // 0~1 生长进度
  needsWater: boolean;         // 是否需要浇水
  missedWaterCycles: number;   // 错过的浇水周期数
  timeToNextStage: number;     // 距下一阶段的毫秒数
  timeToMature: number;        // 距成熟的毫秒数
  estimatedYield: number;      // 预计产出
}

/** 农场操作结果 */
export interface FarmActionResult {
  success: boolean;
  message?: string;
  farmState?: FarmState;
  pointsEarned?: number;
  newBalance?: number;
  dailyEarned?: number;
  limitReached?: boolean;
  expGained?: number;
  levelUp?: boolean;
  newLevel?: FarmLevel;
}

/** 农场初始化/获取响应 */
export interface FarmInitResponse {
  farmState: FarmState;
  weather: WeatherType;
  balance: number;
  dailyEarned: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
}

/** 收获详情 */
export interface HarvestDetail {
  cropId: CropId;
  cropName: string;
  cropIcon: string;
  baseYield: number;
  weatherBonus: number;
  waterBonus: number;
  pestPenalty: number;
  finalYield: number;
  expGained: number;
}
