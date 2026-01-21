import { kv } from "@vercel/kv";
import { tryUseExtraSpin, getExtraSpinCount, addExtraSpinCount, tryClaimDailyFree, releaseDailyFree, checkDailyLimit, rollbackExtraSpin } from "./kv";

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
const LOTTERY_CODES_PREFIX = "lottery:codes:";        // 所有码（Set）
const LOTTERY_USED_CODES_PREFIX = "lottery:used:";    // 已使用的码（Set）
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

// 添加兑换码到档位（使用 Set 存储）
export async function addCodesToTier(tierId: string, codes: string[]): Promise<number> {
  if (codes.length === 0) return 0;

  // 使用 sadd 添加到 Set（自动去重）
  // Vercel KV 的 sadd 接受多个参数
  let added = 0;
  try {
    // 尝试批量添加
    for (const code of codes) {
      const result = await kv.sadd(`${LOTTERY_CODES_PREFIX}${tierId}`, code);
      added += result;
    }
  } catch (error) {
    console.error("Error adding codes to tier:", error);
    throw error;
  }

  // 更新档位库存计数
  const config = await getLotteryConfig();
  const totalInSet = await kv.scard(`${LOTTERY_CODES_PREFIX}${tierId}`);
  const usedCount = await kv.scard(`${LOTTERY_USED_CODES_PREFIX}${tierId}`);
  
  const updatedTiers = config.tiers.map((tier) => {
    if (tier.id === tierId) {
      return { ...tier, codesCount: totalInSet, usedCount };
    }
    return tier;
  });
  await updateLotteryConfig({ tiers: updatedTiers });

  return added;
}

// 获取档位可用兑换码数量（总数 - 已使用）
export async function getTierAvailableCodesCount(tierId: string): Promise<number> {
  try {
    const total = await kv.scard(`${LOTTERY_CODES_PREFIX}${tierId}`) || 0;
    const used = await kv.scard(`${LOTTERY_USED_CODES_PREFIX}${tierId}`) || 0;
    return total - used;
  } catch (error) {
    console.error("Error getting tier available count:", error);
    return 0;
  }
}

// 获取档位已使用数量
export async function getTierUsedCodesCount(tierId: string): Promise<number> {
  try {
    return await kv.scard(`${LOTTERY_USED_CODES_PREFIX}${tierId}`) || 0;
  } catch (error) {
    console.error("Error getting tier used count:", error);
    return 0;
  }
}

// 清空档位库存（清空所有码和已使用标记）
export async function clearTierCodes(tierId: string): Promise<{ cleared: number }> {
  const count = await kv.scard(`${LOTTERY_CODES_PREFIX}${tierId}`);
  if (count > 0) {
    await kv.del(`${LOTTERY_CODES_PREFIX}${tierId}`);
  }
  await kv.del(`${LOTTERY_USED_CODES_PREFIX}${tierId}`);
  
  // 更新档位库存计数
  const config = await getLotteryConfig();
  const updatedTiers = config.tiers.map((tier) => {
    if (tier.id === tierId) {
      return { ...tier, codesCount: 0, usedCount: 0 };
    }
    return tier;
  });
  await updateLotteryConfig({ tiers: updatedTiers });
  
  return { cleared: count };
}

// 重置整个抽奖系统
export async function resetLotterySystem(clearRecords: boolean = false): Promise<{ 
  clearedCodes: number; 
  clearedRecords: number;
}> {
  let totalCleared = 0;
  
  // 1. 清空所有档位的兑换码和已使用标记
  for (const tier of DEFAULT_TIERS) {
    const count = await kv.scard(`${LOTTERY_CODES_PREFIX}${tier.id}`);
    if (count > 0) {
      await kv.del(`${LOTTERY_CODES_PREFIX}${tier.id}`);
      totalCleared += count;
    }
    await kv.del(`${LOTTERY_USED_CODES_PREFIX}${tier.id}`);
  }
  
  // 2. 重置配置到默认状态（计数归零）
  await kv.set(LOTTERY_CONFIG_KEY, DEFAULT_CONFIG);
  
  // 3. 可选：清空抽奖记录
  let clearedRecords = 0;
  if (clearRecords) {
    const recordsCount = await kv.llen(LOTTERY_RECORDS_KEY);
    await kv.del(LOTTERY_RECORDS_KEY);
    clearedRecords = recordsCount;
  }
  
  return { clearedCodes: totalCleared, clearedRecords };
}

// 根据兑换码查找所属档位
export async function findCodeTier(code: string): Promise<{ tierId: string; tierName: string; tierValue: number } | null> {
  for (const tier of DEFAULT_TIERS) {
    const exists = await kv.sismember(`${LOTTERY_CODES_PREFIX}${tier.id}`, code);
    if (exists) {
      return { tierId: tier.id, tierName: tier.name, tierValue: tier.value };
    }
  }
  return null;
}

// 检查码是否已使用
export async function isCodeUsed(tierId: string, code: string): Promise<boolean> {
  const result = await kv.sismember(`${LOTTERY_USED_CODES_PREFIX}${tierId}`, code);
  return result === 1;
}

// [M5修复] 重新统计：分批扫描所有已发放记录，检索每个码的真实档位，更新统计并修正记录（包括用户记录）
export async function recalculateStats(): Promise<{
  processed: number;
  corrected: number;
  notFound: number;
  details: { code: string; recorded: string; actual: string; recordId: string }[];
}> {
  let processed = 0;
  let corrected = 0;
  let notFound = 0;
  const details: { code: string; recorded: string; actual: string; recordId: string }[] = [];
  const allRecords: LotteryRecord[] = [];
  
  // [M5修复] 分批获取所有记录，每批1000条
  const BATCH_SIZE = 1000;
  let offset = 0;
  while (true) {
    const batch = await kv.lrange<LotteryRecord>(LOTTERY_RECORDS_KEY, offset, offset + BATCH_SIZE - 1);
    if (!batch || batch.length === 0) break;
    allRecords.push(...batch);
    offset += batch.length;
    if (batch.length < BATCH_SIZE) break; // 最后一批
  }
  
  const correctedRecords: LotteryRecord[] = [];
  // 按用户分组记录修正（用于更新用户记录）
  const userRecordsMap: Map<string, LotteryRecord[]> = new Map();
  
  // 清空所有档位的已使用标记
  for (const tier of DEFAULT_TIERS) {
    await kv.del(`${LOTTERY_USED_CODES_PREFIX}${tier.id}`);
  }
  
  // 遍历每条记录，根据兑换码找到真实档位
  for (const record of allRecords) {
    processed++;
    const actualTier = await findCodeTier(record.code);
    
    let correctedRecord = record;
    
    if (actualTier) {
      // 标记为已使用（在真实档位中）
      await kv.sadd(`${LOTTERY_USED_CODES_PREFIX}${actualTier.tierId}`, record.code);
      
      // 检查是否与记录的档位一致
      if (actualTier.tierName !== record.tierName) {
        corrected++;
        details.push({
          code: record.code,
          recorded: record.tierName,
          actual: actualTier.tierName,
          recordId: record.id,
        });
        // 修正记录
        correctedRecord = {
          ...record,
          tierName: actualTier.tierName,
          tierValue: actualTier.tierValue,
        };
      }
    } else {
      // 码不在任何档位中（可能是旧数据或被删除）
      notFound++;
    }
    
    correctedRecords.push(correctedRecord);
    
    // 按用户分组
    const userId = record.oderId;
    if (!userRecordsMap.has(userId)) {
      userRecordsMap.set(userId, []);
    }
    userRecordsMap.get(userId)!.push(correctedRecord);
  }
  
  // 用修正后的记录替换原记录
  if (corrected > 0 || allRecords.length > 0) {
    await kv.del(LOTTERY_RECORDS_KEY);
    // 倒序添加，因为 lpush 是从头部插入
    for (let i = correctedRecords.length - 1; i >= 0; i--) {
      await kv.lpush(LOTTERY_RECORDS_KEY, correctedRecords[i]);
    }
    
    // [M5修复] 同步更新每个用户的记录
    for (const [userId, records] of userRecordsMap) {
      await kv.del(`${LOTTERY_USER_RECORDS_PREFIX}${userId}`);
      // 倒序添加
      for (let i = records.length - 1; i >= 0; i--) {
        await kv.lpush(`${LOTTERY_USER_RECORDS_PREFIX}${userId}`, records[i]);
      }
    }
  }
  
  // 更新配置中的统计数据
  const config = await getLotteryConfig();
  const updatedTiers = await Promise.all(config.tiers.map(async (tier) => {
    const total = await kv.scard(`${LOTTERY_CODES_PREFIX}${tier.id}`) || 0;
    const used = await kv.scard(`${LOTTERY_USED_CODES_PREFIX}${tier.id}`) || 0;
    return { ...tier, codesCount: total, usedCount: used };
  }));
  await updateLotteryConfig({ tiers: updatedTiers });
  
  return { processed, corrected, notFound, details };
}

// [M6修复] 检查是否有可抽奖的档位（概率>0的档位必须有库存）
export async function checkAllTiersHaveCodes(): Promise<boolean> {
  const config = await getLotteryConfig();
  for (const tier of config.tiers) {
    // 只检查概率>0的档位，概率为0的档位不影响抽奖
    if (tier.probability > 0) {
      const count = await getTierAvailableCodesCount(tier.id);
      if (count === 0) {
        return false;
      }
    }
  }
  return true;
}

// [M6修复] 获取可抽奖的档位（概率>0且有库存）
export async function getAvailableTiers(): Promise<LotteryTier[]> {
  const config = await getLotteryConfig();
  const available: LotteryTier[] = [];
  
  for (const tier of config.tiers) {
    if (tier.probability > 0) {
      const count = await getTierAvailableCodesCount(tier.id);
      if (count > 0) {
        available.push(tier);
      }
    }
  }
  
  return available;
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

// 执行抽奖 - [C2/C3修复] 使用原子操作防止竞态
export async function spinLottery(
  userId: number,
  username: string
): Promise<{ success: boolean; record?: LotteryRecord; message: string }> {
  // === 第一步：原子性扣减次数 ===
  let usedExtraSpin = false;
  let usedDailyFree = false;
  
  // 1. 优先尝试消耗额外次数（原子操作）
  const extraResult = await tryUseExtraSpin(userId);
  
  if (extraResult.success) {
    usedExtraSpin = true;
  } else {
    // 2. 如果没有额外次数，尝试原子性占用每日免费次数
    const dailyResult = await tryClaimDailyFree(userId);
    if (!dailyResult) {
      return { success: false, message: "今日免费次数已用完，请签到获取更多机会" };
    }
    usedDailyFree = true;
  }

  // === 第二步：检查配置和库存 ===
  const config = await getLotteryConfig();
  if (!config.enabled) {
    // 补偿：返还已扣减的次数
    if (usedExtraSpin) await rollbackExtraSpin(userId);
    if (usedDailyFree) await releaseDailyFree(userId);
    return { success: false, message: "抽奖活动暂未开放" };
  }

  const allHaveCodes = await checkAllTiersHaveCodes();
  if (!allHaveCodes) {
    // 补偿：返还已扣减的次数
    if (usedExtraSpin) await rollbackExtraSpin(userId);
    if (usedDailyFree) await releaseDailyFree(userId);
    return { success: false, message: "库存不足，请联系管理员" };
  }

  // === 第三步：选择档位并原子性抢占兑换码 ===
  const selectedTier = weightedRandomSelect(config.tiers);
  
  // [C2修复] 使用 SADD 返回值做原子抢占，最多重试5次
  const MAX_RETRIES = 5;
  let code: string | null = null;
  
  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    // 随机获取一个码
    const candidateCode = await kv.srandmember<string>(`${LOTTERY_CODES_PREFIX}${selectedTier.id}`);
    if (!candidateCode) {
      break; // 没有可用码了
    }
    
    // 尝试原子性标记为已使用
    // SADD 返回 1 表示成功添加（抢占成功），返回 0 表示已存在（被别人抢了）
    const addResult = await kv.sadd(`${LOTTERY_USED_CODES_PREFIX}${selectedTier.id}`, candidateCode);
    
    if (addResult === 1) {
      // 抢占成功
      code = candidateCode;
      break;
    }
    // 抢占失败，重试获取另一个码
  }
  
  if (!code) {
    // 补偿：返还已扣减的次数
    if (usedExtraSpin) await rollbackExtraSpin(userId);
    if (usedDailyFree) await releaseDailyFree(userId);
    return { success: false, message: "兑换码已用尽，请联系管理员" };
  }

  // === 第四步：创建记录并更新统计 ===
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
  const usedCountNew = await kv.scard(`${LOTTERY_USED_CODES_PREFIX}${selectedTier.id}`);
  const updatedTiers = config.tiers.map((tier) => {
    if (tier.id === selectedTier.id) {
      return { ...tier, usedCount: usedCountNew };
    }
    return tier;
  });
  await updateLotteryConfig({ tiers: updatedTiers });

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
