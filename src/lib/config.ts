// src/lib/config.ts - 系统配置管理

import { kv } from '@vercel/kv';

// 配置 Key
const SYSTEM_CONFIG_KEY = 'system:config';

// 系统配置接口
export interface SystemConfig {
  // 游戏积分上限
  dailyPointsLimit: number;
  
  // 更新时间
  updatedAt?: number;
  updatedBy?: string;
}

// 默认配置
const DEFAULT_CONFIG: SystemConfig = {
  dailyPointsLimit: 2000,
};

/**
 * 获取系统配置
 */
export async function getSystemConfig(): Promise<SystemConfig> {
  const config = await kv.get<SystemConfig>(SYSTEM_CONFIG_KEY);
  
  if (!config) {
    return DEFAULT_CONFIG;
  }
  
  // 合并默认值（防止新增字段缺失）
  return {
    ...DEFAULT_CONFIG,
    ...config,
  };
}

/**
 * 更新系统配置
 */
export async function updateSystemConfig(
  updates: Partial<SystemConfig>,
  updatedBy?: string
): Promise<SystemConfig> {
  const current = await getSystemConfig();
  
  const newConfig: SystemConfig = {
    ...current,
    ...updates,
    updatedAt: Date.now(),
    updatedBy,
  };
  
  await kv.set(SYSTEM_CONFIG_KEY, newConfig);
  
  return newConfig;
}

/**
 * 获取每日积分上限
 */
export async function getDailyPointsLimit(): Promise<number> {
  const config = await getSystemConfig();
  return config.dailyPointsLimit;
}
