// src/lib/store.ts

import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import { StoreItem, ExchangeLog } from './types/store';
import { deductPoints } from './points';
import { creditQuotaToUser } from './new-api';
import { CARD_DRAW_PRICE } from './cards/constants';

// ============ 商店商品管理 ============

const STORE_ITEMS_KEY = 'store:items';
const STORE_ITEM_PURCHASE_COUNTS_KEY = 'store:item:purchase_counts';

// 预定义商品（首次访问时初始化）
const DEFAULT_STORE_ITEMS: Omit<StoreItem, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: '抽奖机会 x1',
    description: '兑换一次抽奖机会',
    type: 'lottery_spin',
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
    pointsCost: CARD_DRAW_PRICE,
    value: 1,
    dailyLimit: 0, // 不限购
    sortOrder: 5,
    enabled: true,
  },
  {
    name: '账户额度 $1',
    description: '直接充值 $1 到您的账户',
    type: 'quota_direct',
    pointsCost: 3500,
    value: 1,
    dailyLimit: 1,  // 每日限购1次
    sortOrder: 10,
    enabled: true,
  },
  {
    name: '账户额度 $5',
    description: '直接充值 $5 到您的账户（优惠）',
    type: 'quota_direct',
    pointsCost: 16000,  // 约9折
    value: 5,
    dailyLimit: 1,  // 每日限购1次
    sortOrder: 11,
    enabled: true,
  },
];

/**
 * 初始化默认商品（如果不存在）
 */
export async function initDefaultStoreItems(): Promise<void> {
  const existing = await kv.hgetall<Record<string, StoreItem>>(STORE_ITEMS_KEY);
  const existingItems = existing ? Object.values(existing) : [];
  if (existingItems.length > 0) {
    // 兼容历史数据：已初始化过商店但缺少后续新增的默认商品（如 card_draw）
    const hasCardDrawItem = existingItems.some(item => item.type === 'card_draw');
    if (!hasCardDrawItem) {
      const now = Date.now();
      const cardDrawItem = DEFAULT_STORE_ITEMS.find(item => item.type === 'card_draw');
      if (cardDrawItem) {
        const id = nanoid();
        const storeItem: StoreItem = {
          ...cardDrawItem,
          id,
          createdAt: now,
          updatedAt: now,
        };
        await kv.hset(STORE_ITEMS_KEY, { [id]: storeItem });
      }
    }
    return;
  }

  const now = Date.now();
  for (const item of DEFAULT_STORE_ITEMS) {
    const id = nanoid();
    const storeItem: StoreItem = {
      ...item,
      id,
      createdAt: now,
      updatedAt: now,
    };
    await kv.hset(STORE_ITEMS_KEY, { [id]: storeItem });
  }
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
  
  return Object.values(items).sort((a, b) => a.sortOrder - b.sortOrder);
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
import { getTodayDateString } from './time';

/**
 * 记录兑换日志
 */
async function logExchange(log: ExchangeLog): Promise<void> {
  const key = `exchange_log:${log.userId}`;
  await kv.lpush(key, log);
  await kv.ltrim(key, 0, 99); // 保留最近100条
}

/**
 * 执行商品兑换
 */
export async function exchangeItem(
  userId: number,
  itemId: string
): Promise<{ success: boolean; message: string; log?: ExchangeLog }> {
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

  // 2. 检查每日限购（原子操作：先 INCR 占位，超限则 DECR 回滚）
  const today = getTodayDateString();
  let dailyLimitKey: string | null = null;
  if (item.dailyLimit) {
    dailyLimitKey = `exchange:daily:${userId}:${today}:${itemId}`;
    const newCount = await kv.incr(dailyLimitKey);
    // 设置过期时间（首次递增时）
    if (newCount === 1) {
      await kv.expire(dailyLimitKey, 48 * 60 * 60);
    }
    // 超限则回滚
    if (newCount > item.dailyLimit) {
      await kv.decr(dailyLimitKey);
      return { success: false, message: `今日已达限购上限（${item.dailyLimit}次）` };
    }
  }

  // 3. 扣除积分（原子操作）
  const deductResult = await deductPoints(
    userId,
    item.pointsCost,
    'exchange',
    `兑换 ${item.name}`
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

  try {
    if (item.type === 'lottery_spin') {
      // 增加抽奖次数
      await addExtraSpinCount(userId, item.value);
      rewardSuccess = true;
      rewardMessage = `获得 ${item.value} 次抽奖机会`;
    } else if (item.type === 'card_draw') {
      // 增加卡牌抽奖次数
      const result = await addCardDraws(userId, item.value);
      rewardSuccess = result.success;
      rewardMessage = result.success 
        ? `获得 ${item.value} 次卡牌抽奖机会` 
        : '卡牌抽奖次数增加失败';
    } else if (item.type === 'quota_direct') {
      // 直充额度
      const creditResult = await creditQuotaToUser(userId, item.value);
      rewardSuccess = creditResult.success;
      rewardMessage = creditResult.message;
    }
  } catch (error) {
    console.error('Reward delivery error:', error);
    rewardMessage = '奖励发放失败';
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
      const { addPoints } = await import('./points');
      await addPoints(
        userId,
        item.pointsCost,
        'admin_adjust',
        `兑换失败回滚: ${item.name}`
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
    itemName: item.name,
    pointsCost: item.pointsCost,
    value: item.value,
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
    await kv.hincrby(STORE_ITEM_PURCHASE_COUNTS_KEY, itemId, 1);
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
