/**
 * 补签卡库存模块（KV）
 *
 * key: user:makeup_cards:{userId} → number
 * 复用 d1-kv 的 incrby/decrby/get，与 extra spins 的实现风格一致。
 */

import { kv } from '@/lib/d1-kv';

const MAKEUP_KEY = (userId: number) => `user:makeup_cards:${userId}`;

/**
 * 查询用户当前持有的补签卡数量。
 */
export async function getMakeupCardCount(userId: number): Promise<number> {
  const v = await kv.get<number>(MAKEUP_KEY(userId));
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 增加补签卡库存（购买 / 管理员发放）。返回新余额。
 */
export async function addMakeupCards(userId: number, count: number): Promise<number> {
  if (!Number.isFinite(count) || count <= 0) {
    return getMakeupCardCount(userId);
  }
  const next = await kv.incrby(MAKEUP_KEY(userId), Math.floor(count));
  return Number(next) || 0;
}

/**
 * 原子消耗 1 张补签卡。
 *
 * 实现：先 DECRBY 占位，若结果为负数说明库存不足，立即 INCRBY 回滚。
 * 与 src/lib/kv.ts 的 tryUseExtraSpin 相同风格，保证并发安全。
 */
export async function tryConsumeMakeupCard(
  userId: number,
): Promise<{ success: boolean; remaining: number }> {
  const key = MAKEUP_KEY(userId);
  const after = Number(await kv.decrby(key, 1));
  if (!Number.isFinite(after) || after < 0) {
    // 回滚
    try {
      await kv.incrby(key, 1);
    } catch (err) {
      console.error('回滚补签卡失败:', err);
    }
    return { success: false, remaining: 0 };
  }
  return { success: true, remaining: after };
}
