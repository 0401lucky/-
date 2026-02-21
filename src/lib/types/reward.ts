// src/lib/types/reward.ts

export type RewardType = 'points' | 'quota';
export type RewardTargetMode = 'all' | 'selected';
export type RewardBatchStatus = 'distributing' | 'completed' | 'failed';
export type RewardClaimStatus = 'pending' | 'claimed' | 'failed';

/** 发放批次 */
export interface RewardBatch {
  id: string;                    // nanoid(16)
  type: RewardType;
  amount: number;                // 积分数量 或 美元金额
  targetMode: RewardTargetMode;
  targetUserIds: number[];       // selected 模式时的目标用户
  title: string;                 // 通知标题
  message: string;               // 通知内容
  createdBy: string;             // 管理员 username
  createdAt: number;
  status: RewardBatchStatus;
  totalTargets: number;
  distributedCount: number;
  claimedCount: number;
  failedClaimCount: number;
}

/** 用户领取记录（每个用户每个批次唯一） */
export interface RewardClaim {
  id: string;
  batchId: string;
  userId: number;
  notificationId: string;        // 关联通知 ID
  type: RewardType;
  amount: number;
  status: RewardClaimStatus;
  claimedAt?: number;
  failReason?: string;
  retryCount: number;
}
