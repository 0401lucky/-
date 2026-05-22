// src/lib/store.ts

import { kv } from '@/lib/d1-kv';
import { nanoid } from 'nanoid';
import { StoreCategory, StoreItem, ExchangeLog } from './types/store';
import { deductPoints, applyPointsDelta } from './points';
import { creditQuotaToUser } from './new-api';
import { CARD_DRAW_PRICE } from './cards/constants';
import { MAKEUP_CARD_POINTS_COST } from './checkin-rules';

// ============ 商店商品管理 ============

const STORE_ITEMS_KEY = 'store:items';
const STORE_CATEGORIES_KEY = 'store:categories';
const STORE_ITEM_PURCHASE_COUNTS_KEY = 'store:item:purchase_counts';

const DEFAULT_STORE_CATEGORIES: Omit<StoreCategory, 'createdAt' | 'updatedAt'>[] = [
  { id: 'lottery', name: '抽奖次数', color: '#06b6d4', sortOrder: 1, enabled: true },
  { id: 'card', name: '卡牌抽卡', color: '#3b82f6', sortOrder: 2, enabled: true },
  { id: 'makeup', name: '补签道具', color: '#22c55e', sortOrder: 3, enabled: true },
];

function getDefaultCategoryId(type: StoreItem['type']): string {
  if (type === 'card_draw') return 'card';
  if (type === 'makeup_card') return 'makeup';
  return 'lottery';
}

// 预定义商品（首次访问时初始化）
// 注意：账户额度直充（quota_direct）已下架，仅保留兼容历史数据；新签到规则改为本地积分。
const DEFAULT_STORE_ITEMS: Omit<StoreItem, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: '抽奖机会 x1',
    description: '兑换一次抽奖机会',
    type: 'lottery_spin',
    categoryId: 'lottery',
    pointsCost: 13000,
    value: 1,
    dailyLimit: 1,
    sortOrder: 1,
    enabled: true,
  },
  {
    name: '抽奖机会 x2',
    description: '兑换两次抽奖机会',
    type: 'lottery_spin',
    categoryId: 'lottery',
    pointsCost: 24000,
    value: 2,
    dailyLimit: 1,
    sortOrder: 2,
    enabled: true,
  },
  {
    name: '动物卡抽卡次数 x1',
    description: '兑换一次动物卡抽卡机会',
    type: 'card_draw',
    categoryId: 'card',
    pointsCost: CARD_DRAW_PRICE,
    value: 1,
    dailyLimit: 0, // 不限购
    sortOrder: 5,
    enabled: true,
  },
  {
    name: '补签卡 x1',
    description: '用于补回本周漏签的日子，补签后视同已签到，可恢复积分梯度并补发该日应得的积分与额外抽奖。',
    type: 'makeup_card',
    categoryId: 'makeup',
    pointsCost: MAKEUP_CARD_POINTS_COST,
    value: 1,
    dailyLimit: 0, // 不限购
    sortOrder: 8,
    enabled: true,
  },
];

export async function initDefaultStoreCategories(): Promise<void> {
  const existing = await kv.hgetall<Record<string, StoreCategory>>(STORE_CATEGORIES_KEY);
  const now = Date.now();
  const updates: Record<string, StoreCategory> = {};

  for (const category of DEFAULT_STORE_CATEGORIES) {
    const saved = existing?.[category.id];
    if (!saved) {
      updates[category.id] = {
        ...category,
        createdAt: now,
        updatedAt: now,
      };
    }
  }

  if (Object.keys(updates).length > 0) {
    await kv.hset(STORE_CATEGORIES_KEY, updates);
  }
}

/**
 * 初始化默认商品（如果不存在）
 *
 * 同时承担两类一次性迁移：
 * 1) 历史 quota_direct 商品（原"账户额度直充"）→ 强制下架（enabled=false），
 *    与签到规则升级保持一致；用户在配套发布前已购买的不影响。
 * 2) 历史数据中缺少 card_draw、makeup_card 等新商品 → 自动补齐。
 */
export async function initDefaultStoreItems(): Promise<void> {
  await initDefaultStoreCategories();
  const existing = await kv.hgetall<Record<string, StoreItem>>(STORE_ITEMS_KEY);
  const existingItems = existing ? Object.values(existing) : [];
  if (existingItems.length > 0) {
    const now = Date.now();
    const updates: Record<string, StoreItem> = {};

    // 迁移 1：将 quota_direct 强制下架
    for (const item of existingItems) {
      if (item.type === 'quota_direct' && item.enabled) {
        updates[item.id] = { ...item, enabled: false, updatedAt: now };
      } else if (!item.categoryId && item.type !== 'quota_direct') {
        updates[item.id] = { ...item, categoryId: getDefaultCategoryId(item.type), updatedAt: now };
      }
    }

    // 迁移 2：缺失 card_draw 时补齐（兼容老逻辑）
    const hasCardDrawItem = existingItems.some((item) => item.type === 'card_draw');
    if (!hasCardDrawItem) {
      const cardDrawItem = DEFAULT_STORE_ITEMS.find((item) => item.type === 'card_draw');
      if (cardDrawItem) {
        const id = nanoid();
        updates[id] = {
          ...cardDrawItem,
          id,
          createdAt: now,
          updatedAt: now,
        };
      }
    }

    // 迁移 3：缺失 makeup_card 时补齐
    const hasMakeupCardItem = existingItems.some((item) => item.type === 'makeup_card');
    if (!hasMakeupCardItem) {
      const makeupItem = DEFAULT_STORE_ITEMS.find((item) => item.type === 'makeup_card');
      if (makeupItem) {
        const id = nanoid();
        updates[id] = {
          ...makeupItem,
          id,
          createdAt: now,
          updatedAt: now,
        };
      }
    }

    if (Object.keys(updates).length > 0) {
      await kv.hset(STORE_ITEMS_KEY, updates);
    }
    return;
  }

  const now = Date.now();
  const batch: Record<string, StoreItem> = {};
  for (const item of DEFAULT_STORE_ITEMS) {
    const id = nanoid();
    batch[id] = {
      ...item,
      id,
      createdAt: now,
      updatedAt: now,
    };
  }
  await kv.hset(STORE_ITEMS_KEY, batch);
}

/**
 * 获取商品分类（默认只返回启用分类）
 */
export async function getStoreCategories(includeDisabled = false): Promise<StoreCategory[]> {
  await initDefaultStoreCategories();
  const categories = await kv.hgetall<Record<string, StoreCategory>>(STORE_CATEGORIES_KEY);
  if (!categories) return [];

  return Object.values(categories)
    .filter((category) => includeDisabled || category.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function createStoreCategory(
  data: Omit<StoreCategory, 'id' | 'createdAt' | 'updatedAt'>
): Promise<StoreCategory> {
  const now = Date.now();
  const id = nanoid();
  const category: StoreCategory = {
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  };
  await kv.hset(STORE_CATEGORIES_KEY, { [id]: category });
  return category;
}

export async function updateStoreCategory(
  id: string,
  updates: Partial<Omit<StoreCategory, 'id' | 'createdAt'>>
): Promise<StoreCategory | null> {
  const existing = await kv.hget<StoreCategory>(STORE_CATEGORIES_KEY, id);
  if (!existing) return null;

  const updated: StoreCategory = {
    ...existing,
    ...updates,
    id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  await kv.hset(STORE_CATEGORIES_KEY, { [id]: updated });
  return updated;
}

/**
 * 获取所有上架商品
 */
export async function getStoreItems(): Promise<StoreItem[]> {
  await initDefaultStoreItems();
  const items = await kv.hgetall<Record<string, StoreItem>>(STORE_ITEMS_KEY);
  if (!items) return [];
  
  return Object.values(items)
    .filter(item => item.enabled)
    .map(item => ({ ...item, categoryId: item.categoryId ?? getDefaultCategoryId(item.type) }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * 获取单个商品
 */
export async function getStoreItem(itemId: string): Promise<StoreItem | null> {
  const item = await kv.hget<StoreItem>(STORE_ITEMS_KEY, itemId);
  return item;
}

/**
 * 获取所有商品（含下架，管理员用）
 */
export async function getAllStoreItems(): Promise<StoreItem[]> {
  await initDefaultStoreItems();
  const items = await kv.hgetall<Record<string, StoreItem>>(STORE_ITEMS_KEY);
  if (!items) return [];
  
  return Object.values(items)
    .map(item => ({ ...item, categoryId: item.categoryId ?? getDefaultCategoryId(item.type) }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * 创建商品
 */
export async function createStoreItem(
  data: Omit<StoreItem, 'id' | 'createdAt' | 'updatedAt'>
): Promise<StoreItem> {
  const now = Date.now();
  const id = nanoid();
  const item: StoreItem = {
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  };
  await kv.hset(STORE_ITEMS_KEY, { [id]: item });
  return item;
}

/**
 * 更新商品
 */
export async function updateStoreItem(
  id: string,
  updates: Partial<Omit<StoreItem, 'id' | 'createdAt'>>
): Promise<StoreItem | null> {
  const existing = await getStoreItem(id);
  if (!existing) return null;
  
  const updated: StoreItem = {
    ...existing,
    ...updates,
    id, // 确保 id 不变
    createdAt: existing.createdAt, // 保持原创建时间
    updatedAt: Date.now(),
  };
  await kv.hset(STORE_ITEMS_KEY, { [id]: updated });
  return updated;
}

/**
 * 删除商品
 */
export async function deleteStoreItem(id: string): Promise<boolean> {
  const existing = await getStoreItem(id);
  if (!existing) return false;
  
  await kv.hdel(STORE_ITEMS_KEY, id);
  return true;
}

// ============ 兑换逻辑 ============

// 导入抽奖次数增加函数（从kv.ts）
import { addExtraSpinCount, addCardDraws } from './kv';
import { addMakeupCards } from './makeup-cards';
import { getTodayDateString } from './time';

/**
 * 记录兑换日志
 */
async function logExchange(log: ExchangeLog): Promise<void> {
  const key = `exchange_log:${log.userId}`;
  await kv.lpush(key, log);
  await kv.ltrim(key, 0, 99); // 保留最近100条
}

interface UncertainExchangeLog extends ExchangeLog {
  status: 'uncertain';
  detail: string;
}

/**
 * 记录直充不确定状态（便于后续人工核对/补偿）
 */
async function logUncertainExchange(log: ExchangeLog, detail: string): Promise<void> {
  const key = `exchange_uncertain:${log.userId}`;
  const payload: UncertainExchangeLog = {
    ...log,
    status: 'uncertain',
    detail,
  };
  await kv.lpush(key, payload);
  await kv.ltrim(key, 0, 99); // 保留最近100条
}

/**
 * 执行商品兑换
 */
export async function exchangeItem(
  userId: number,
  itemId: string,
  quantity: number = 1
): Promise<{ success: boolean; message: string; log?: ExchangeLog; uncertain?: boolean }> {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return { success: false, message: '数量参数错误' };
  }

  // 1. 获取商品信息
  const item = await getStoreItem(itemId);
  if (!item) {
    return { success: false, message: '商品不存在' };
  }
  if (!item.enabled) {
    return { success: false, message: '商品已下架' };
  }
  // 防御式校验：确保 pointsCost 是有效正整数
  if (!Number.isSafeInteger(item.pointsCost) || item.pointsCost < 1) {
    console.error(`Invalid pointsCost for item ${itemId}: ${item.pointsCost}`);
    return { success: false, message: '商品配置异常，请联系管理员' };
  }
  // 防御式校验：确保 value 是有效正整数
  if (!Number.isSafeInteger(item.value) || item.value < 1) {
    console.error(`Invalid value for item ${itemId}: ${item.value}`);
    return { success: false, message: '商品配置异常，请联系管理员' };
  }

  const hasDailyLimit = Number.isSafeInteger(item.dailyLimit) && (item.dailyLimit ?? 0) > 0;
  if (hasDailyLimit && quantity !== 1) {
    return { success: false, message: '该商品为限购商品，不支持选择数量' };
  }

  const totalPointsCost = item.pointsCost * quantity;
  if (!Number.isSafeInteger(totalPointsCost) || totalPointsCost < 1) {
    console.error(`Invalid totalPointsCost for item ${itemId} (pointsCost=${item.pointsCost}, quantity=${quantity})`);
    return { success: false, message: '兑换数量过大，请减少数量后重试' };
  }

  const totalValue = item.value * quantity;
  if (!Number.isSafeInteger(totalValue) || totalValue < 1) {
    console.error(`Invalid totalValue for item ${itemId} (value=${item.value}, quantity=${quantity})`);
    return { success: false, message: '兑换数量过大，请减少数量后重试' };
  }

  // 2. 检查每日限购（原子操作：先 INCR 占位，超限则 DECR 回滚）
  const today = getTodayDateString();
  let dailyLimitKey: string | null = null;
  if (hasDailyLimit) {
    dailyLimitKey = `exchange:daily:${userId}:${today}:${itemId}`;

    // D1-compatible: increment counter, check limit, rollback if exceeded
    const newCount = await kv.incrby(dailyLimitKey, 1);
    if (newCount === 1) {
      await kv.expire(dailyLimitKey, 48 * 60 * 60);
    }

    let limitOk: number;
    if (newCount > (item.dailyLimit as number)) {
      await kv.decrby(dailyLimitKey, 1);
      limitOk = 0;
    } else {
      limitOk = 1;
    }

    if (limitOk !== 1) {
      return { success: false, message: `今日已达限购上限（${item.dailyLimit}次）` };
    }
  }

  // 3. 扣除积分（原子操作）
  const descriptionSuffix = quantity > 1 ? ` ×${quantity}` : '';
  const deductResult = await deductPoints(
    userId,
    totalPointsCost,
    'exchange',
    `兑换 ${item.name}${descriptionSuffix}`
  );
  if (!deductResult.success) {
    // 扣积分失败，回滚限购占位
    if (dailyLimitKey) {
      try {
        await kv.decr(dailyLimitKey);
      } catch (e) {
        console.error('Rollback daily limit on deduct fail:', e);
      }
    }
    return { success: false, message: deductResult.message || '积分扣除失败' };
  }

  // 4. 发放奖励
  let rewardSuccess = false;
  let rewardMessage = '';
  let rewardUncertain = false;

  try {
    if (item.type === 'lottery_spin') {
      // 增加抽奖次数
      await addExtraSpinCount(userId, totalValue);
      rewardSuccess = true;
      rewardMessage = `获得 ${totalValue} 次抽奖机会`;
    } else if (item.type === 'card_draw') {
      // 增加卡牌抽奖次数
      const result = await addCardDraws(userId, totalValue);
      rewardSuccess = result.success;
      rewardMessage = result.success
        ? `获得 ${totalValue} 次卡牌抽奖机会`
        : '卡牌抽奖次数增加失败';
    } else if (item.type === 'makeup_card') {
      // 补签卡：增加用户的补签卡库存
      try {
        await addMakeupCards(userId, totalValue);
        rewardSuccess = true;
        rewardMessage = `获得 ${totalValue} 张补签卡，可在签到页面使用`;
      } catch (error) {
        console.error('Add makeup cards failed:', error);
        rewardSuccess = false;
        rewardMessage = '补签卡发放失败';
      }
    } else if (item.type === 'quota_direct') {
      // 直充额度（已下架，仅保留兼容）
      const creditResult = await creditQuotaToUser(userId, totalValue) as {
        success: boolean;
        message: string;
        uncertain?: boolean;
      };

      if (creditResult.uncertain) {
        rewardUncertain = true;
        rewardMessage = creditResult.message || '充值结果不确定，请稍后查看余额';
      } else {
        rewardSuccess = creditResult.success;
        rewardMessage = creditResult.message;
      }
    }
  } catch (error) {
    console.error('Reward delivery error:', error);
    rewardMessage = '奖励发放失败';
  }

  if (rewardUncertain) {
    const uncertainLog: ExchangeLog = {
      id: nanoid(),
      userId,
      itemId,
      itemName: quantity > 1 ? `${item.name} ×${quantity}（直充待确认）` : `${item.name}（直充待确认）`,
      pointsCost: totalPointsCost,
      value: totalValue,
      type: item.type,
      createdAt: Date.now(),
    };

    console.warn('Quota direct exchange uncertain:', {
      userId,
      itemId,
      pointsCost: totalPointsCost,
      value: totalValue,
      message: rewardMessage,
    });

    try {
      await logExchange(uncertainLog);
    } catch (logError) {
      console.error('Exchange log write failed (uncertain):', logError);
    }

    try {
      await logUncertainExchange(uncertainLog, rewardMessage);
    } catch (uncertainLogError) {
      console.error('Uncertain exchange log write failed:', uncertainLogError);
    }

    try {
      await kv.hincrby(STORE_ITEM_PURCHASE_COUNTS_KEY, itemId, quantity);
    } catch (countError) {
      console.error('Store item purchase count increment failed (uncertain, non-critical):', countError);
    }

    const uncertainHint = '本次兑换已登记为待确认状态，请勿重复兑换，稍后查看账户余额。';
    return {
      success: true,
      message: `${rewardMessage}（${uncertainHint}）`,
      uncertain: true,
      log: uncertainLog,
    };
  }

  // 5. 如果奖励发放失败，回滚积分和限购计数（尽力而为）
  if (!rewardSuccess) {
    // 回滚限购计数
    if (dailyLimitKey) {
      try {
        await kv.decr(dailyLimitKey);
      } catch (e) {
        console.error('Rollback daily limit failed:', e);
      }
    }
    // 回滚积分
    try {
      await applyPointsDelta(
        userId,
        totalPointsCost,
        'exchange_refund',
        `兑换失败积分回滚: ${item.name}${descriptionSuffix}`
      );
    } catch (rollbackError) {
      console.error('Rollback failed:', rollbackError);
      // 即使回滚失败也要记录
    }
    return { success: false, message: rewardMessage || '奖励发放失败，积分已退还' };
  }

  // 6. 记录兑换日志（降级为 best-effort，失败不影响成功响应）
  const log: ExchangeLog = {
    id: nanoid(),
    userId,
    itemId,
    itemName: quantity > 1 ? `${item.name} ×${quantity}` : item.name,
    pointsCost: totalPointsCost,
    value: totalValue,
    type: item.type,
    createdAt: Date.now(),
  };
  
  try {
    await logExchange(log);
  } catch (logError) {
    // 日志写入失败不影响兑换成功，仅记录错误
    console.error('Exchange log write failed (non-critical):', logError);
  }

  // 7. 统计商品被兑换次数（best-effort，失败不影响成功响应）
  try {
    await kv.hincrby(STORE_ITEM_PURCHASE_COUNTS_KEY, itemId, quantity);
  } catch (countError) {
    console.error('Store item purchase count increment failed (non-critical):', countError);
  }

  return { 
    success: true, 
    message: rewardMessage,
    log,
  };
}

/**
 * 获取用户兑换记录
 */
export async function getExchangeLogs(
  userId: number,
  limit: number = 20
): Promise<ExchangeLog[]> {
  const key = `exchange_log:${userId}`;
  const logs = await kv.lrange<ExchangeLog>(key, 0, limit - 1);
  return logs || [];
}
