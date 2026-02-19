// src/lib/types/farm-shop.ts - 农场道具商店类型定义

/** 道具效果类型 */
export type FarmItemEffectType =
  | 'auto_water'
  | 'auto_harvest'
  | 'pest_shield'
  | 'weather_shield'
  | 'yield_bonus'
  | 'growth_speed'
  | 'growth_boost'
  | 'plot_growth_boost'
  | 'pest_clear'
  | 'random_plant';

/** 道具模式 */
export type FarmItemMode = 'buff' | 'instant';

/** 农场道具商品 */
export interface FarmShopItem {
  id: string;
  name: string;
  icon: string;
  description: string;
  effect: FarmItemEffectType;
  mode: FarmItemMode;
  pointsCost: number;
  durationMs?: number;      // buff持续时间(ms)
  effectValue?: number;     // 效果数值（0.25=+25%, 2=2x速度, 0.8=降低80%）
  instantValue?: number;    // 即时效果数值（毫秒）
  dailyLimit?: number;      // 每日限购
  maxStack?: number;        // buff最大叠加（默认1，同类不可叠加）
  unlockLevel?: number;     // 解锁等级
  sortOrder: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 激活中的 buff */
export interface ActiveBuff {
  itemId: string;
  effect: FarmItemEffectType;
  activatedAt: number;
  expiresAt: number;
  effectValue?: number;
}

/** 引擎用的 buff 上下文（从 ActiveBuff[] 构建） */
export interface BuffContext {
  autoWater?: { activatedAt: number; expiresAt: number };
  pestShield?: { activatedAt: number; expiresAt: number; reduction: number };
  growthSpeed?: { activatedAt: number; expiresAt: number; multiplier: number };
  yieldBonus?: { multiplier: number };
  weatherShield?: { active: boolean };
  autoHarvest?: { active: boolean };
}
