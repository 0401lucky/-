// src/lib/rewards.ts

import { kv } from '@/lib/d1-kv';
import { nanoid } from 'nanoid';
import { getAllUsers } from './kv';
import { createUserNotification } from './notifications';
import type { NotificationItem } from './notifications';
import { addPoints } from './points';
import { creditQuotaToUser } from './new-api';
import { maskUserId } from './logging';
import type {
  RewardBatch,
  RewardBatchStatus,
  RewardClaim,
  RewardClaimStatus,
  RewardTargetMode,
  RewardType,
} from './types/reward';

// KV Key 规划
const BATCH_KEY = (batchId: string) => `rewards:batch:${batchId}`;
const BATCH_LIST_KEY = 'rewards:batch:list';
const CLAIM_KEY = (batchId: string, userId: number) => `rewards:claim:${batchId}:${userId}`;
const CLAIM_LOCK_KEY = (batchId: string, userId: number) => `rewards:claim:lock:${batchId}:${userId}`;
const BATCH_NOTIFIED_KEY = (batchId: string) => `rewards:batch:notified:${batchId}`;

// ---------- 管理员: 创建并分发奖励批次 ----------

export interface CreateRewardBatchInput {
  type: RewardType;
  amount: number;
  targetMode: RewardTargetMode;
  targetUserIds?: number[];
  title: string;
  message: string;
  createdBy: string;
}

export async function createAndDistributeRewardBatch(
  input: CreateRewardBatchInput
): Promise<RewardBatch> {
  const { type, amount, targetMode, targetUserIds, title, message, createdBy } = input;

  // 校验
  if (amount <= 0) throw new Error('奖励数量必须大于 0');
  if (type === 'quota' && amount > 100) throw new Error('单次直充额度不能超过 100 美元');
  if (type === 'points' && amount > 1000000) throw new Error('单次积分不能超过 1,000,000');
  if (!title.trim()) throw new Error('通知标题不能为空');
  if (!message.trim()) throw new Error('通知内容不能为空');

  // 确定目标用户
  let targetIds: number[];
  if (targetMode === 'all') {
    const users = await getAllUsers();
    targetIds = users.map((u) => Number(u.id)).filter((id) => Number.isFinite(id));
  } else {
    if (!targetUserIds || targetUserIds.length === 0) {
      throw new Error('指定用户模式必须提供目标用户列表');
    }
    targetIds = targetUserIds;
  }

  if (targetIds.length === 0) {
    throw new Error('没有可分发的目标用户');
  }

  const batchId = nanoid(16);
  const now = Date.now();

  const batch: RewardBatch = {
    id: batchId,
    type,
    amount,
    targetMode,
    targetUserIds: targetMode === 'selected' ? targetIds : [],
    title: title.trim(),
    message: message.trim(),
    createdBy,
    createdAt: now,
    status: 'distributing',
    totalTargets: targetIds.length,
    distributedCount: 0,
    claimedCount: 0,
    failedClaimCount: 0,
  };

  await kv.set(BATCH_KEY(batchId), batch);
  await kv.lpush(BATCH_LIST_KEY, batchId);

  // 循环分发
  let distributedCount = 0;
  const dedupeKey = BATCH_NOTIFIED_KEY(batchId);

  for (const userId of targetIds) {
    try {
      // 去重
      const added = await kv.sadd(dedupeKey, userId);
      if (Number(added) !== 1) continue;

      // 创建通知
      const notification = await createUserNotification({
        userId,
        type: 'reward',
        title: batch.title,
        content: batch.message,
        data: {
          rewardBatchId: batchId,
          rewardType: type,
          rewardAmount: amount,
          claimStatus: 'pending' as RewardClaimStatus,
        },
      });

      // 创建 RewardClaim
      const claim: RewardClaim = {
        id: nanoid(16),
        batchId,
        userId,
        notificationId: notification.id,
        type,
        amount,
        status: 'pending',
        retryCount: 0,
      };
      await kv.set(CLAIM_KEY(batchId, userId), claim);

      distributedCount++;
    } catch (error) {
      // 分发失败，回滚去重标记
      try {
        await kv.srem(dedupeKey, userId);
      } catch {
        // ignore
      }
      console.error('Reward distribution failed', {
        batchId,
        userId: maskUserId(userId),
        error,
      });
    }
  }

  // 设置去重集合过期（180天）
  await kv.expire(dedupeKey, 180 * 24 * 60 * 60);

  // 更新批次状态
  batch.distributedCount = distributedCount;
  batch.status = 'completed';
  await kv.set(BATCH_KEY(batchId), batch);

  return batch;
}

// ---------- 管理员: 查询批次列表 ----------

export async function listRewardBatches(
  page: number = 1,
  limit: number = 20
): Promise<{
  items: RewardBatch[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const allIds = await kv.lrange<string>(BATCH_LIST_KEY, 0, -1);
  const ids = allIds ?? [];
  const total = ids.length;
  const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

  const start = (page - 1) * limit;
  const pagedIds = ids.slice(start, start + limit);

  if (pagedIds.length === 0) {
    return { items: [], total, page, limit, totalPages };
  }

  const keys = pagedIds.map((id) => BATCH_KEY(id));
  const results = await kv.mget<RewardBatch>(...keys);
  const items = (results ?? []).filter((b): b is RewardBatch => b !== null);

  return { items, total, page, limit, totalPages };
}

// ---------- 管理员: 查询批次详情 ----------

export async function getRewardBatch(batchId: string): Promise<RewardBatch | null> {
  return kv.get<RewardBatch>(BATCH_KEY(batchId));
}

// ---------- 用户: 领取奖励 ----------

export async function claimReward(
  userId: number,
  notificationId: string,
  notification: NotificationItem
): Promise<{
  success: boolean;
  message: string;
  claimStatus: RewardClaimStatus;
}> {
  const data = notification.data as {
    rewardBatchId?: string;
    rewardType?: RewardType;
    rewardAmount?: number;
    claimStatus?: RewardClaimStatus;
  } | undefined;

  if (!data?.rewardBatchId) {
    return { success: false, message: '通知数据无效', claimStatus: 'pending' };
  }

  const batchId = data.rewardBatchId;

  // 获取 claim 记录
  const claim = await kv.get<RewardClaim>(CLAIM_KEY(batchId, userId));
  if (!claim) {
    return { success: false, message: '未找到领取记录', claimStatus: 'pending' };
  }

  // 已领取 → 幂等返回
  if (claim.status === 'claimed') {
    return { success: true, message: '奖励已领取', claimStatus: 'claimed' };
  }

  // 获取分布式锁
  const lockKey = CLAIM_LOCK_KEY(batchId, userId);
  const lockAcquired = await kv.set(lockKey, '1', { ex: 10, nx: true });
  if (!lockAcquired) {
    return { success: false, message: '正在处理中，请稍后重试', claimStatus: claim.status };
  }

  try {
    // 双重检查
    const freshClaim = await kv.get<RewardClaim>(CLAIM_KEY(batchId, userId));
    if (!freshClaim || freshClaim.status === 'claimed') {
      return { success: true, message: '奖励已领取', claimStatus: 'claimed' };
    }

    // 执行发放
    let claimSuccess = false;
    let failReason = '';

    if (freshClaim.type === 'points') {
      try {
        await addPoints(
          userId,
          freshClaim.amount,
          'reward_claim',
          `奖励领取: ${notification.title}`
        );
        claimSuccess = true;
      } catch (error) {
        failReason = error instanceof Error ? error.message : '积分发放失败';
      }
    } else if (freshClaim.type === 'quota') {
      try {
        const result = await creditQuotaToUser(userId, freshClaim.amount);
        // creditQuotaToUser 返回 success=false 时也可能实际成功（uncertain 视为成功）
        claimSuccess = result.success;
        if (!claimSuccess) {
          failReason = result.message || '额度充值失败';
        }
      } catch (error) {
        failReason = error instanceof Error ? error.message : '额度充值失败';
      }
    }

    const now = Date.now();

    if (claimSuccess) {
      // 更新 claim 状态
      freshClaim.status = 'claimed';
      freshClaim.claimedAt = now;
      await kv.set(CLAIM_KEY(batchId, userId), freshClaim);

      // 更新通知 data.claimStatus
      const updatedNotification: NotificationItem = {
        ...notification,
        data: { ...notification.data, claimStatus: 'claimed' },
        readAt: notification.readAt ?? now,
      };
      await kv.set(`notifications:item:${notificationId}`, updatedNotification);

      // 标记通知已读
      await kv.srem(`notifications:user:${userId}:unread`, notificationId);

      // 更新批次统计
      const batch = await kv.get<RewardBatch>(BATCH_KEY(batchId));
      if (batch) {
        batch.claimedCount = (batch.claimedCount || 0) + 1;
        await kv.set(BATCH_KEY(batchId), batch);
      }

      return { success: true, message: '奖励领取成功', claimStatus: 'claimed' };
    } else {
      // 失败
      freshClaim.status = 'failed';
      freshClaim.failReason = failReason;
      freshClaim.retryCount = (freshClaim.retryCount || 0) + 1;
      await kv.set(CLAIM_KEY(batchId, userId), freshClaim);

      // 更新通知 data.claimStatus
      const updatedNotification: NotificationItem = {
        ...notification,
        data: { ...notification.data, claimStatus: 'failed' },
      };
      await kv.set(`notifications:item:${notificationId}`, updatedNotification);

      // 更新批次统计
      const batch = await kv.get<RewardBatch>(BATCH_KEY(batchId));
      if (batch) {
        batch.failedClaimCount = (batch.failedClaimCount || 0) + 1;
        await kv.set(BATCH_KEY(batchId), batch);
      }

      return { success: false, message: failReason || '领取失败', claimStatus: 'failed' };
    }
  } finally {
    // 释放锁
    await kv.del(lockKey);
  }
}
