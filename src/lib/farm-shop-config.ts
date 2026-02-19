// src/lib/farm-shop-config.ts - 农场道具默认配置

import type { FarmShopItem } from './types/farm-shop';

/** 默认道具配置（不含 id/createdAt/updatedAt，初始化时自动生成） */
export const DEFAULT_FARM_SHOP_ITEMS: Omit<FarmShopItem, 'id' | 'createdAt' | 'updatedAt'>[] = [
  // ---- Buff 道具（时限生效） ----
  {
    name: '小猫助手',
    icon: '🐱',
    description: '自动浇水，12小时内无需手动浇水',
    effect: 'auto_water',
    mode: 'buff',
    pointsCost: 80,
    durationMs: 12 * 60 * 60 * 1000, // 12h
    sortOrder: 1,
    enabled: true,
  },
  {
    name: '自动收割机',
    icon: '🤖',
    description: '自动收获成熟作物，12小时内成熟即收',
    effect: 'auto_harvest',
    mode: 'buff',
    pointsCost: 120,
    durationMs: 12 * 60 * 60 * 1000, // 12h
    sortOrder: 2,
    enabled: true,
  },
  {
    name: '稻草人',
    icon: '🛡️',
    description: '害虫概率降低80%，24小时守护',
    effect: 'pest_shield',
    mode: 'buff',
    pointsCost: 60,
    durationMs: 24 * 60 * 60 * 1000, // 24h
    effectValue: 0.8, // 降低80%
    sortOrder: 3,
    enabled: true,
  },
  {
    name: '天气穹顶',
    icon: '☂️',
    description: '免疫恶劣天气减产，24小时保护',
    effect: 'weather_shield',
    mode: 'buff',
    pointsCost: 100,
    durationMs: 24 * 60 * 60 * 1000, // 24h
    sortOrder: 4,
    enabled: true,
  },
  {
    name: '丰收之星',
    icon: '⭐',
    description: '收获产量+25%，12小时加成',
    effect: 'yield_bonus',
    mode: 'buff',
    pointsCost: 150,
    durationMs: 12 * 60 * 60 * 1000, // 12h
    effectValue: 0.25, // +25%
    sortOrder: 5,
    enabled: true,
  },
  {
    name: '时光沙漏',
    icon: '⏩',
    description: '生长速度2倍，6小时加速',
    effect: 'growth_speed',
    mode: 'buff',
    pointsCost: 200,
    durationMs: 6 * 60 * 60 * 1000, // 6h
    effectValue: 2, // 2x
    sortOrder: 6,
    enabled: true,
  },

  // ---- 即时道具（一次性消耗） ----
  {
    name: '时光加速器',
    icon: '🧪',
    description: '全部田地作物加速生长60分钟',
    effect: 'growth_boost',
    mode: 'instant',
    pointsCost: 80,
    instantValue: 60 * 60 * 1000, // 60分钟
    sortOrder: 7,
    enabled: true,
  },
  {
    name: '高级肥料',
    icon: '💊',
    description: '指定一块田加速生长30分钟',
    effect: 'plot_growth_boost',
    mode: 'instant',
    pointsCost: 30,
    instantValue: 30 * 60 * 1000, // 30分钟
    sortOrder: 8,
    enabled: true,
  },
  {
    name: '速效驱虫剂',
    icon: '🔫',
    description: '清除全部害虫 + 2小时害虫免疫',
    effect: 'pest_clear',
    mode: 'instant',
    pointsCost: 40,
    instantValue: 2 * 60 * 60 * 1000, // 2h免疫
    sortOrder: 9,
    enabled: true,
  },
  {
    name: '神秘种子袋',
    icon: '🎲',
    description: '随机作物免费种在空地上',
    effect: 'random_plant',
    mode: 'instant',
    pointsCost: 50,
    sortOrder: 10,
    enabled: true,
  },
];
