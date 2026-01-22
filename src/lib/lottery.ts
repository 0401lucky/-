import { kv } from "@vercel/kv";
import { tryUseExtraSpin, tryClaimDailyFree, releaseDailyFree, rollbackExtraSpin } from "./kv";

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
  code: string;           // 兑换码模式使用
  directCredit?: boolean; // 是否为直充模式
  creditedQuota?: number; // 直充的 quota 数量
  createdAt: number;
}

// 抽奖配置
export interface LotteryConfig {
  enabled: boolean;
  mode: 'code' | 'direct' | 'hybrid';  // code=兑换码, direct=直充, hybrid=优先直充降级兑换码
  dailyDirectLimit: number;            // 每日直充发放上限（美元），默认2000
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
  mode: 'direct',        // 默认使用直充模式
  dailyDirectLimit: 2000, // 每日直充上限 $2000
  tiers: DEFAULT_TIERS,
};

// KV Keys
const LOTTERY_CONFIG_KEY = "lottery:config";
const LOTTERY_CODES_PREFIX = "lottery:codes:";        // 所有码（Set）
const LOTTERY_USED_CODES_PREFIX = "lottery:used:";    // 已使用的码（Set）
const LOTTERY_RECORDS_KEY = "lottery:records";
const LOTTERY_USER_RECORDS_PREFIX = "lottery:user:records:";

// 获取抽奖配置（自动合并默认值，兼容旧配置）
export async function getLotteryConfig(): Promise<LotteryConfig> {
  const config = await kv.get<Partial<LotteryConfig>>(LOTTERY_CONFIG_KEY);
  if (!config) {
    await kv.set(LOTTERY_CONFIG_KEY, DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  // 合并默认值，确保新增字段有定义
  return {
    enabled: config.enabled ?? DEFAULT_CONFIG.enabled,
    mode: config.mode ?? DEFAULT_CONFIG.mode,
    dailyDirectLimit: typeof config.dailyDirectLimit === 'number' 
      ? config.dailyDirectLimit 
      : DEFAULT_CONFIG.dailyDirectLimit,
    tiers: config.tiers ?? DEFAULT_CONFIG.tiers,
  };
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
      // [P2-1修复] 使用 <= 0 防止异常负数被误判为有库存
      if (count <= 0) {
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


// [Opt-3] 加权随机选择档位 - 添加 totalWeight <= 0 保护
function weightedRandomSelect(tiers: LotteryTier[]): LotteryTier | null {
  const totalWeight = tiers.reduce((sum, tier) => sum + tier.probability, 0);
  
  // [Opt-3] 配置保护：如果所有概率都为0，返回null
  if (totalWeight <= 0) {
    return null;
  }
  
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

// [P1-1/P1-2修复] 执行抽奖 - 使用可用集合 + 原子发码 + 完整异常补偿
export async function spinLottery(
  userId: number,
  username: string
): Promise<{ success: boolean; record?: LotteryRecord; message: string }> {
  // [Final-B] 扣次数阶段也需要 try-catch 兜底
  let usedExtraSpin = false;
  let usedDailyFree = false;
  
  try {
    // === 第一步：原子性扣减次数 ===
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
  } catch (spinCountError) {
    // [Final-B] 扣次数阶段异常：直接返回失败，不需要回滚（因为还没成功扣）
    console.error("扣次数阶段异常:", spinCountError);
    return { success: false, message: "系统繁忙，请稍后再试" };
  }

  // 补偿函数：返还已扣减的次数
  const rollbackSpinCount = async () => {
    try {
      if (usedExtraSpin) await rollbackExtraSpin(userId);
      if (usedDailyFree) await releaseDailyFree(userId);
    } catch (e) {
      console.error("回滚次数失败:", e);
    }
  };

  // 后续逻辑的 try-catch 兜底
  try {
    // === 第二步：检查配置和库存 ===
    const config = await getLotteryConfig();
    if (!config.enabled) {
      await rollbackSpinCount();
      return { success: false, message: "抽奖活动暂未开放" };
    }

    const allHaveCodes = await checkAllTiersHaveCodes();
    if (!allHaveCodes) {
      await rollbackSpinCount();
      return { success: false, message: "库存不足，请联系管理员" };
    }

    // === 第三步：选择档位并原子性获取兑换码 ===
    const selectedTier = weightedRandomSelect(config.tiers);
    
    // [Opt-3] 配置保护：如果所有概率都为0，返回错误
    if (!selectedTier) {
      await rollbackSpinCount();
      return { success: false, message: "抽奖配置异常，请联系管理员" };
    }
    
    // [P1-1修复] 使用可用集合计算
    const allCodesResult = await kv.smembers(`${LOTTERY_CODES_PREFIX}${selectedTier.id}`);
    const usedCodesResult = await kv.smembers(`${LOTTERY_USED_CODES_PREFIX}${selectedTier.id}`);
    const allCodes: string[] = Array.isArray(allCodesResult) ? allCodesResult as string[] : [];
    const usedCodes: string[] = Array.isArray(usedCodesResult) ? usedCodesResult as string[] : [];
    const usedSet = new Set(usedCodes);
    const availableCodes = allCodes.filter((c: string) => !usedSet.has(c));
    
    if (availableCodes.length === 0) {
      await rollbackSpinCount();
      return { success: false, message: "该档位兑换码已用尽，请联系管理员" };
    }
    
    // 随机选择一个可用码
    const randomIndex = Math.floor(Math.random() * availableCodes.length);
    const selectedCode = availableCodes[randomIndex];
    
    // 原子性标记为已使用（SADD 返回 1 表示成功）
    const addResult = await kv.sadd(`${LOTTERY_USED_CODES_PREFIX}${selectedTier.id}`, selectedCode);
    
    if (addResult !== 1) {
      // 极小概率：刚好被别人抢了，重试一次
      const retryUsedCodesResult = await kv.smembers(`${LOTTERY_USED_CODES_PREFIX}${selectedTier.id}`);
      const retryUsedCodes: string[] = Array.isArray(retryUsedCodesResult) ? retryUsedCodesResult as string[] : [];
      const retryUsedSet = new Set(retryUsedCodes);
      const retryAvailable = allCodes.filter((c: string) => !retryUsedSet.has(c));
      
      if (retryAvailable.length === 0) {
        await rollbackSpinCount();
        return { success: false, message: "兑换码已用尽，请联系管理员" };
      }
      
      const retryCode = retryAvailable[Math.floor(Math.random() * retryAvailable.length)];
      const retryResult = await kv.sadd(`${LOTTERY_USED_CODES_PREFIX}${selectedTier.id}`, retryCode);
      
      if (retryResult !== 1) {
        await rollbackSpinCount();
        return { success: false, message: "系统繁忙，请稍后再试" };
      }
      
      // 使用重试成功的码
      // [Opt-1] 提交点失败时释放码
      try {
        return await completeSpinWithCode(retryCode, selectedTier, userId, username);
      } catch (commitError) {
        // 提交点（全局记录写入）失败，尝试释放已占用的码
        console.error("提交点失败，尝试释放码:", commitError);
        try {
          await kv.srem(`${LOTTERY_USED_CODES_PREFIX}${selectedTier.id}`, retryCode);
        } catch (releaseError) {
          console.error("释放码失败:", releaseError);
        }
        throw commitError; // 继续抛出让外层 catch 处理回滚次数
      }
    }
    
    // 使用成功抢占的码
    // [Opt-1] 提交点失败时释放码
    try {
      return await completeSpinWithCode(selectedCode, selectedTier, userId, username);
    } catch (commitError) {
      // 提交点（全局记录写入）失败，尝试释放已占用的码
      console.error("提交点失败，尝试释放码:", commitError);
      try {
        await kv.srem(`${LOTTERY_USED_CODES_PREFIX}${selectedTier.id}`, selectedCode);
      } catch (releaseError) {
        console.error("释放码失败:", releaseError);
      }
      throw commitError; // 继续抛出让外层 catch 处理回滚次数
    }
    
  } catch (error) {
    // [P1-2补充] 全局异常兜底：确保次数被回滚
    console.error("spinLottery 异常:", error);
    await rollbackSpinCount();
    return { success: false, message: "系统错误，请稍后再试" };
  }
}

// [Final-A修复] 完成抽奖的后续操作
// 关键设计：全局记录写入成功即为"提交点"，之后任何失败都不抛错
// 确保上层 spinLottery 不会因为本函数异常而回滚次数
async function completeSpinWithCode(
  code: string,
  selectedTier: LotteryTier,
  userId: number,
  username: string
): Promise<{ success: boolean; record?: LotteryRecord; message: string }> {
  const record: LotteryRecord = {
    id: `lottery_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    oderId: String(userId),
    username,
    tierName: selectedTier.name,
    tierValue: selectedTier.value,
    code,
    createdAt: Date.now(),
  };

  // 第一步：写入全局记录（这是"提交点"）
  await kv.lpush(LOTTERY_RECORDS_KEY, record);
  
  // [Final-A] 提交点之后的所有操作都用 try-catch 包裹，绝不抛错
  // 第二步：写入用户记录（非关键，失败只记录日志）
  try {
    await kv.lpush(`${LOTTERY_USER_RECORDS_PREFIX}${userId}`, record);
  } catch (userRecordError) {
    // 用户记录写入失败，可通过 recalculateStats 修复
    console.error("写入用户记录失败（不影响抽奖结果）:", userRecordError);
  }

  // 第三步：更新统计（非关键，失败只记录日志）
  // [Opt-2] 使用最新 config，避免覆盖管理员刚更新的配置
  try {
    const latestConfig = await getLotteryConfig();
    const usedCountNew = await kv.scard(`${LOTTERY_USED_CODES_PREFIX}${selectedTier.id}`);
    const updatedTiers = latestConfig.tiers.map((tier) => {
      if (tier.id === selectedTier.id) {
        return { ...tier, usedCount: usedCountNew };
      }
      return tier;
    });
    await updateLotteryConfig({ tiers: updatedTiers });
  } catch (statsError) {
    // 统计更新失败不影响抽奖结果，可通过 recalculateStats 后台修复
    console.error("更新统计失败（不影响抽奖结果）:", statsError);
  }

  return {
    success: true,
    record,
    message: `恭喜获得 ${selectedTier.name}！`,
  };
}

// 获取抽奖记录（支持分页）
export async function getLotteryRecords(limit: number = 50, offset: number = 0): Promise<LotteryRecord[]> {
  return await kv.lrange<LotteryRecord>(LOTTERY_RECORDS_KEY, offset, offset + limit - 1);
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

// ============ 直充模式相关函数 ============

const LOTTERY_DAILY_DIRECT_KEY = "lottery:daily_direct:"; // 每日直充发放记录

/**
 * 获取今日已发放的直充金额（美元）
 */
export async function getTodayDirectTotal(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const total = await kv.get<number>(`${LOTTERY_DAILY_DIRECT_KEY}${today}`);
  return total || 0;
}

/**
 * 检查今日直充额度是否充足（仅用于门禁判断，不做预占）
 * @param dollars 本次需要发放的金额
 * @returns 是否可以发放
 */
export async function checkDailyDirectLimit(dollars: number): Promise<boolean> {
  const config = await getLotteryConfig();
  const todayTotal = await getTodayDirectTotal();
  return (todayTotal + dollars) <= config.dailyDirectLimit;
}

/**
 * 原子性预占今日直充额度（INCRBY + 超限回滚）
 * @param dollars 要预占的金额
 * @returns { success: boolean, newTotal: number } 
 */
export async function reserveDailyDirectQuota(dollars: number): Promise<{ success: boolean; newTotal: number }> {
  const config = await getLotteryConfig();
  const today = new Date().toISOString().slice(0, 10);
  const key = `${LOTTERY_DAILY_DIRECT_KEY}${today}`;
  
  // 原子性增加
  const newTotal = await kv.incrby(key, dollars);
  
  // 首次创建时设置过期时间（48小时）
  // 注意：incrby 不会重置 TTL，需要在首次创建时设置
  const ttl = await kv.ttl(key);
  if (ttl === -1) { // -1 表示没有过期时间
    await kv.expire(key, 48 * 60 * 60);
  }
  
  // 检查是否超限
  if (newTotal > config.dailyDirectLimit) {
    // 超限，回滚
    await kv.decrby(key, dollars);
    return { success: false, newTotal: newTotal - dollars };
  }
  
  return { success: true, newTotal };
}

/**
 * 回滚预占的直充额度
 * @param dollars 要回滚的金额
 */
export async function rollbackDailyDirectQuota(dollars: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${LOTTERY_DAILY_DIRECT_KEY}${today}`;
  await kv.decrby(key, dollars);
}

/**
 * 获取最小可中奖档位值（概率>0的档位中的最小值）
 */
export async function getMinTierValue(): Promise<number> {
  const config = await getLotteryConfig();
  const activeTiers = config.tiers.filter(t => t.probability > 0);
  if (activeTiers.length === 0) return Infinity;
  return Math.min(...activeTiers.map(t => t.value));
}

/**
 * 直充模式抽奖
 * 抽奖后直接给用户 new-api 账户充值
 * 改进：根据剩余额度过滤可选档位，确保选中的档位一定能直充成功
 */
export async function spinLotteryDirect(
  userId: number,
  username: string
): Promise<{ success: boolean; record?: LotteryRecord; message: string; uncertain?: boolean }> {
  // 动态导入避免循环依赖
  const { creditQuotaToUser } = await import('./new-api');
  
  let usedExtraSpin = false;
  let usedDailyFree = false;

  try {
    // === 第一步：原子性扣减次数 ===
    const extraResult = await tryUseExtraSpin(userId);
    
    if (extraResult.success) {
      usedExtraSpin = true;
    } else {
      const dailyResult = await tryClaimDailyFree(userId);
      if (!dailyResult) {
        return { success: false, message: "今日免费次数已用完，请签到获取更多机会" };
      }
      usedDailyFree = true;
    }
  } catch (spinCountError) {
    console.error("扣次数阶段异常:", spinCountError);
    return { success: false, message: "系统繁忙，请稍后再试" };
  }

  const rollbackSpinCount = async () => {
    try {
      if (usedExtraSpin) await rollbackExtraSpin(userId);
      if (usedDailyFree) await releaseDailyFree(userId);
    } catch (e) {
      console.error("回滚次数失败:", e);
    }
  };

  let reservedDollars = 0; // 记录已预占的额度，用于回滚

  try {
    // === 第二步：检查配置 ===
    const config = await getLotteryConfig();
    if (!config.enabled) {
      await rollbackSpinCount();
      return { success: false, message: "抽奖活动暂未开放" };
    }

    // === 第三步：获取剩余额度并过滤可选档位 ===
    const todayTotal = await getTodayDirectTotal();
    const remainingQuota = config.dailyDirectLimit - todayTotal;
    
    // 过滤掉超过剩余额度的档位
    const affordableTiers = config.tiers.filter(t => t.probability > 0 && t.value <= remainingQuota);
    
    if (affordableTiers.length === 0) {
      await rollbackSpinCount();
      return { success: false, message: "今日发放额度已达上限，请明日再试" };
    }

    // 在可负担的档位中进行概率抽奖（重新归一化概率）
    const selectedTier = weightedRandomSelect(affordableTiers);
    if (!selectedTier) {
      await rollbackSpinCount();
      return { success: false, message: "抽奖配置异常，请联系管理员" };
    }

    // === 第四步：原子性预占每日直充额度 ===
    const reserveResult = await reserveDailyDirectQuota(selectedTier.value);
    if (!reserveResult.success) {
      await rollbackSpinCount();
      return { success: false, message: "今日发放额度已达上限，请明日再试" };
    }
    reservedDollars = selectedTier.value; // 标记已预占

    // === 第五步：执行直充（提交点前的不可逆操作） ===
    const creditResult = await creditQuotaToUser(userId, selectedTier.value) as { 
      success: boolean; 
      message: string; 
      newQuota?: number;
      uncertain?: boolean;
    };
    
    // 处理"结果不确定"的情况（网络异常但可能已成功）
    if ((creditResult as { uncertain?: boolean }).uncertain) {
      // 结果不确定时，不回滚（避免重复发放风险）
      // 记录为 pending 状态，让管理员后续核实
      console.warn("直充结果不确定，不回滚额度和次数:", creditResult.message);
      
      // 创建一个 pending 记录用于审计
      const pendingRecord: LotteryRecord = {
        id: `lottery_pending_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        oderId: String(userId),
        username,
        tierName: `[待确认] ${selectedTier.name}`,
        tierValue: selectedTier.value,
        code: '',
        directCredit: true,
        createdAt: Date.now(),
      };
      
      try {
        await kv.lpush(LOTTERY_RECORDS_KEY, pendingRecord);
        await kv.lpush(`${LOTTERY_USER_RECORDS_PREFIX}${userId}`, pendingRecord);
      } catch (e) {
        console.error("写入 pending 记录失败:", e);
      }
      
      return { 
        success: false, 
        message: "充值结果不确定，请稍后检查余额。如有问题请联系管理员",
        uncertain: true  // 标记不确定状态，防止 hybrid 降级
      };
    }
    
    if (!creditResult.success) {
      // 明确失败，回滚额度预占和次数
      await rollbackDailyDirectQuota(reservedDollars);
      await rollbackSpinCount();
      console.error("直充失败:", creditResult.message);
      return { success: false, message: "充值失败，请稍后重试" };
    }

    // ============ 提交点 ============
    // creditQuotaToUser 成功后，用户已收到钱，这是不可逆的
    // 从此刻起，不再回滚次数和额度，只做 best-effort 记录写入

    // === 第六步：创建抽奖记录（best-effort，不影响结果） ===
    const record: LotteryRecord = {
      id: `lottery_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      oderId: String(userId),
      username,
      tierName: selectedTier.name,
      tierValue: selectedTier.value,
      code: '',              // 直充模式无兑换码
      directCredit: true,
      creditedQuota: creditResult.newQuota,
      createdAt: Date.now(),
    };

    // 写入全局记录（best-effort）
    try {
      await kv.lpush(LOTTERY_RECORDS_KEY, record);
    } catch (globalRecordError) {
      console.error("写入全局记录失败（充值已成功，不影响用户）:", globalRecordError);
    }

    // 写入用户记录（best-effort）
    try {
      await kv.lpush(`${LOTTERY_USER_RECORDS_PREFIX}${userId}`, record);
    } catch (userRecordError) {
      console.error("写入用户记录失败（充值已成功，不影响用户）:", userRecordError);
    }

    return {
      success: true,
      record,
      message: `恭喜获得 ${selectedTier.name}！已直接充值到您的账户`,
    };

  } catch (error) {
    console.error("spinLotteryDirect 异常:", error);
    // 如果已预占额度但未到提交点，回滚
    if (reservedDollars > 0) {
      await rollbackDailyDirectQuota(reservedDollars);
    }
    await rollbackSpinCount();
    return { success: false, message: "系统错误，请稍后再试" };
  }
}

/**
 * 统一抽奖入口（根据配置选择模式）
 */
export async function spinLotteryAuto(
  userId: number,
  username: string
): Promise<{ success: boolean; record?: LotteryRecord; message: string }> {
  const config = await getLotteryConfig();
  
  switch (config.mode) {
    case 'direct':
      return spinLotteryDirect(userId, username);
    
    case 'code':
      return spinLottery(userId, username);
    
    case 'hybrid':
      // 优先直充，检查是否有任何可抽的直充档位
      const minValue = await getMinTierValue();
      const canDirect = await checkDailyDirectLimit(minValue);
      if (canDirect) {
        const directResult = await spinLotteryDirect(userId, username);
        if (directResult.success) {
          return directResult;
        }
        // 结果不确定时，不降级（避免双重发放风险）
        if (directResult.uncertain) {
          console.warn("直充结果不确定，不降级到兑换码模式");
          return directResult; // 直接返回不确定结果
        }
        // 明确失败（已回滚）时才降级到兑换码模式
        console.log("直充明确失败，降级到兑换码模式:", directResult.message);
      }
      return spinLottery(userId, username);
    
    default:
      return spinLottery(userId, username);
  }
}
