import { kv } from "@vercel/kv";
import { useExtraSpinCount, getExtraSpinCount, addExtraSpinCount, setDailyLimit, checkDailyLimit } from "./kv";

// 抽奖档位
export interface LotteryTier {
  id: string;           // tier_1, tier_3, tier_5, tier_10, tier_15, tier_20
  name: string;         // "1刀福利", "3刀福利"...
  value: number;        // 1, 3, 5, 10, 15, 20
  probability: number;  // 概率百分比: 40, 30, 18, 8, 3, 1
  color: string;        // 转盘扇区颜色
  codesCount: number;   // 总库存
  usedCount: number;    // 已使用
}

// 抽奖记录
export interface LotteryRecord {
  id: string;
  oderId: string;
  username: string;
  tierName: string;
  tierValue: number;
  code: string;
  createdAt: number;
}

// 抽奖配置
export interface LotteryConfig {
  enabled: boolean;
  tiers: LotteryTier[];
}

// 默认配置 - 6个档位，概率方案B
const DEFAULT_TIERS: LotteryTier[] = [
  { id: "tier_1", name: "1刀福利", value: 1, probability: 40, color: "#fbbf24", codesCount: 0, usedCount: 0 },
  { id: "tier_3", name: "3刀福利", value: 3, probability: 30, color: "#fb923c", codesCount: 0, usedCount: 0 },
  { id: "tier_5", name: "5刀福利", value: 5, probability: 18, color: "#f97316", codesCount: 0, usedCount: 0 },
  { id: "tier_10", name: "10刀福利", value: 10, probability: 8, color: "#ea580c", codesCount: 0, usedCount: 0 },
  { id: "tier_15", name: "15刀福利", value: 15, probability: 3, color: "#dc2626", codesCount: 0, usedCount: 0 },
  { id: "tier_20", name: "20刀福利", value: 20, probability: 1, color: "#b91c1c", codesCount: 0, usedCount: 0 },
];

const DEFAULT_CONFIG: LotteryConfig = {
  enabled: true,
  tiers: DEFAULT_TIERS,
};

// KV Keys
const LOTTERY_CONFIG_KEY = "lottery:config";
const LOTTERY_CODES_PREFIX = "lottery:codes:";
// const LOTTERY_DAILY_PREFIX = "lottery:daily:"; // Moved to kv.ts
const LOTTERY_RECORDS_KEY = "lottery:records";
const LOTTERY_USER_RECORDS_PREFIX = "lottery:user:records:";

// 获取抽奖配置
export async function getLotteryConfig(): Promise<LotteryConfig> {
  const config = await kv.get<LotteryConfig>(LOTTERY_CONFIG_KEY);
  if (!config) {
    await kv.set(LOTTERY_CONFIG_KEY, DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  return config;
}

// 更新抽奖配置
export async function updateLotteryConfig(config: Partial<LotteryConfig>): Promise<void> {
  const current = await getLotteryConfig();
  await kv.set(LOTTERY_CONFIG_KEY, { ...current, ...config });
}

// 更新档位概率配置
export async function updateTiersProbability(
  tiersUpdate: { id: string; probability: number }[]
): Promise<void> {
  const config = await getLotteryConfig();
  const updatedTiers = config.tiers.map((tier) => {
    const update = tiersUpdate.find((t) => t.id === tier.id);
    if (update) {
      return { ...tier, probability: update.probability };
    }
    return tier;
  });
  await updateLotteryConfig({ tiers: updatedTiers });
}

// 添加兑换码到档位
export async function addCodesToTier(tierId: string, codes: string[]): Promise<number> {
  if (codes.length === 0) return 0;

  const added = await kv.lpush(`${LOTTERY_CODES_PREFIX}${tierId}`, ...codes);

  // 更新档位库存计数
  const config = await getLotteryConfig();
  const updatedTiers = config.tiers.map((tier) => {
    if (tier.id === tierId) {
      return { ...tier, codesCount: tier.codesCount + codes.length };
    }
    return tier;
  });
  await updateLotteryConfig({ tiers: updatedTiers });

  return added;
}

// 获取档位可用兑换码数量
export async function getTierAvailableCodesCount(tierId: string): Promise<number> {
  return await kv.llen(`${LOTTERY_CODES_PREFIX}${tierId}`);
}

// 清空档位库存
export async function clearTierCodes(tierId: string): Promise<{ cleared: number }> {
  const count = await getTierAvailableCodesCount(tierId);
  if (count > 0) {
    await kv.del(`${LOTTERY_CODES_PREFIX}${tierId}`);
  }
  
  // 更新档位库存计数
  const config = await getLotteryConfig();
  const updatedTiers = config.tiers.map((tier) => {
    if (tier.id === tierId) {
      return { ...tier, codesCount: tier.usedCount }; // 保留已使用的计数，清除可用库存
    }
    return tier;
  });
  await updateLotteryConfig({ tiers: updatedTiers });
  
  return { cleared: count };
}

// 检查是否所有档位都有库存
export async function checkAllTiersHaveCodes(): Promise<boolean> {
  const config = await getLotteryConfig();
  for (const tier of config.tiers) {
    const count = await getTierAvailableCodesCount(tier.id);
    if (count === 0) {
      return false;
    }
  }
  return true;
}

// 获取各档位库存统计
export async function getTiersStats(): Promise<{ id: string; available: number }[]> {
  const config = await getLotteryConfig();
  const stats: { id: string; available: number }[] = [];
  for (const tier of config.tiers) {
    const available = await getTierAvailableCodesCount(tier.id);
    stats.push({ id: tier.id, available });
  }
  return stats;
}


// 加权随机选择档位
function weightedRandomSelect(tiers: LotteryTier[]): LotteryTier {
  const totalWeight = tiers.reduce((sum, tier) => sum + tier.probability, 0);
  let random = Math.random() * totalWeight;

  for (const tier of tiers) {
    random -= tier.probability;
    if (random <= 0) {
      return tier;
    }
  }

  // 兜底返回最后一个
  return tiers[tiers.length - 1];
}

// 执行抽奖
export async function spinLottery(
  userId: number,
  username: string
): Promise<{ success: boolean; record?: LotteryRecord; message: string }> {
  // 1. 优先消耗额外次数
  let usedExtraSpin = false;
  const extraSpinSuccess = await useExtraSpinCount(userId);
  
  if (extraSpinSuccess) {
    usedExtraSpin = true;
  } else {
    // 2. 如果没有额外次数，检查每日限制
    const hasSpun = await checkDailyLimit(userId);
    if (hasSpun) {
      return { success: false, message: "今日免费次数已用完，请签到获取更多机会" };
    }
  }

  // 检查配置是否启用
  const config = await getLotteryConfig();
  if (!config.enabled) {
    // 如果使用了额外次数但活动未开启，需要返还次数（简单起见这里暂不处理返还，假设UI层会先检查）
    return { success: false, message: "抽奖活动暂未开放" };
  }

  // 检查所有档位是否有库存
  const allHaveCodes = await checkAllTiersHaveCodes();
  if (!allHaveCodes) {
    return { success: false, message: "库存不足，请联系管理员" };
  }

  // 加权随机选择档位
  const selectedTier = weightedRandomSelect(config.tiers);

  // 从档位获取兑换码
  const code = await kv.rpop<string>(`${LOTTERY_CODES_PREFIX}${selectedTier.id}`);
  if (!code) {
    return { success: false, message: "兑换码已用尽，请联系管理员" };
  }

  // 创建抽奖记录
  const record: LotteryRecord = {
    id: `lottery_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    oderId: String(userId),
    username,
    tierName: selectedTier.name,
    tierValue: selectedTier.value,
    code,
    createdAt: Date.now(),
  };

  // 保存记录
  await kv.lpush(LOTTERY_RECORDS_KEY, record);
  await kv.lpush(`${LOTTERY_USER_RECORDS_PREFIX}${userId}`, record);

  // 更新档位已使用计数
  const updatedTiers = config.tiers.map((tier) => {
    if (tier.id === selectedTier.id) {
      return { ...tier, usedCount: tier.usedCount + 1 };
    }
    return tier;
  });
  await updateLotteryConfig({ tiers: updatedTiers });

  // 如果没有使用额外次数，则标记今日已使用免费次数
  if (!usedExtraSpin) {
    await setDailyLimit(userId);
  }

  return {
    success: true,
    record,
    message: `恭喜获得 ${selectedTier.name}！`,
  };
}

// 获取抽奖记录
export async function getLotteryRecords(limit: number = 50): Promise<LotteryRecord[]> {
  return await kv.lrange<LotteryRecord>(LOTTERY_RECORDS_KEY, 0, limit - 1);
}

// 获取用户抽奖记录
export async function getUserLotteryRecords(
  userId: number,
  limit: number = 20
): Promise<LotteryRecord[]> {
  return await kv.lrange<LotteryRecord>(
    `${LOTTERY_USER_RECORDS_PREFIX}${userId}`,
    0,
    limit - 1
  );
}
