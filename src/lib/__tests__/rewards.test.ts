import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationItem } from '../notifications';
import type { RewardBatch, RewardClaim } from '../types/reward';
import { claimReward, createAndDistributeRewardBatch } from '../rewards';
import { kv } from '@/lib/d1-kv';
import { getAllUsers } from '../kv';
import { createUserNotification } from '../notifications';
import { addPoints } from '../points';
import { creditQuotaToUser } from '../new-api';
import { nanoid } from 'nanoid';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    sadd: vi.fn(),
    srem: vi.fn(),
    zrem: vi.fn(),
    lpush: vi.fn(),
    expire: vi.fn(),
  },
}));

vi.mock('../kv', () => ({
  getAllUsers: vi.fn(),
}));

vi.mock('../notifications', () => ({
  createUserNotification: vi.fn(),
}));

vi.mock('../points', () => ({
  addPoints: vi.fn(),
}));

vi.mock('../new-api', () => ({
  creditQuotaToUser: vi.fn(),
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(),
}));

describe('rewards safety fixes', () => {
  const mockKvSet = vi.mocked(kv.set);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvDel = vi.mocked(kv.del);
  const mockKvSadd = vi.mocked(kv.sadd);
  const mockKvSrem = vi.mocked(kv.srem);
  const mockKvZrem = vi.mocked(kv.zrem);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockKvExpire = vi.mocked(kv.expire);

  const mockGetAllUsers = vi.mocked(getAllUsers);
  const mockCreateUserNotification = vi.mocked(createUserNotification);
  const mockAddPoints = vi.mocked(addPoints);
  const mockCreditQuotaToUser = vi.mocked(creditQuotaToUser);
  const mockNanoid = vi.mocked(nanoid);

  const kvStore = new Map<string, unknown>();
  let notificationSeq = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    kvStore.clear();
    notificationSeq = 0;

    let nanoSeq = 0;
    mockNanoid.mockImplementation(() => `id-${++nanoSeq}`);

    mockKvSet.mockImplementation(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx) {
        if (kvStore.has(key)) {
          return null;
        }
        kvStore.set(key, value);
        return 'OK';
      }
      kvStore.set(key, value);
      return 'OK';
    });

    mockKvGet.mockImplementation(async (key: string) => {
      return (kvStore.get(key) as unknown) ?? null;
    });

    mockKvDel.mockImplementation(async (...keys: string[]) => {
      let removed = 0;
      for (const key of keys) {
        if (kvStore.delete(key)) {
          removed += 1;
        }
      }
      return removed;
    });

    mockKvSadd.mockResolvedValue(1);
    mockKvSrem.mockResolvedValue(1);
    mockKvZrem.mockResolvedValue(1);
    mockKvLpush.mockResolvedValue(1);
    mockKvExpire.mockResolvedValue(1);

    mockGetAllUsers.mockResolvedValue([]);
    mockAddPoints.mockResolvedValue({ success: true, balance: 1000 });
    mockCreditQuotaToUser.mockResolvedValue({ success: true, message: 'ok' });

    mockCreateUserNotification.mockImplementation(async (input) => {
      const id = `n-${++notificationSeq}`;
      return {
        id,
        userId: input.userId,
        type: input.type,
        title: input.title,
        content: input.content,
        data: input.data,
        createdAt: Date.now(),
      } as NotificationItem;
    });
  });

  it('dedupes selected users and marks batch failed when partial distribution fails', async () => {
    const originalSet = mockKvSet.getMockImplementation();
    if (!originalSet) throw new Error('mockKvSet implementation missing');

    mockKvSet.mockImplementation(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (key === 'rewards:claim:id-1:2') {
        throw new Error('claim write failed');
      }
      return originalSet(key, value, options);
    });

    const batch = await createAndDistributeRewardBatch({
      type: 'points',
      amount: 100,
      targetMode: 'selected',
      targetUserIds: [1, 1, 2],
      title: '测试发放',
      message: '测试消息',
      createdBy: 'admin',
    });

    expect(batch.targetUserIds).toEqual([1, 2]);
    expect(batch.totalTargets).toBe(2);
    expect(batch.distributedCount).toBe(1);
    expect(batch.status).toBe('failed');
    expect(mockCreateUserNotification).toHaveBeenCalledTimes(2);
    expect(mockKvDel).toHaveBeenCalledWith('notifications:item:n-2');
    expect(mockKvZrem).toHaveBeenCalledWith('notifications:user:2:index', 'n-2');
    expect(
      mockKvSrem.mock.calls.some(
        (call) => call[0] === 'notifications:user:2:unread' && call[1] === 'n-2'
      )
    ).toBe(true);
  });

  it('treats uncertain quota result as claimed to avoid duplicate credit retry', async () => {
    const batchId = 'batch-uncertain';
    const userId = 101;
    const notificationId = 'n-uncertain';
    const claimKey = `rewards:claim:${batchId}:${userId}`;
    const batchKey = `rewards:batch:${batchId}`;

    kvStore.set(claimKey, {
      id: 'claim-1',
      batchId,
      userId,
      notificationId,
      type: 'quota',
      amount: 2,
      status: 'pending',
      retryCount: 0,
    } satisfies RewardClaim);

    kvStore.set(batchKey, {
      id: batchId,
      type: 'quota',
      amount: 2,
      targetMode: 'selected',
      targetUserIds: [userId],
      title: '额度奖励',
      message: '请领取',
      createdBy: 'admin',
      createdAt: Date.now(),
      status: 'completed',
      totalTargets: 1,
      distributedCount: 1,
      claimedCount: 0,
      failedClaimCount: 0,
    } satisfies RewardBatch);

    mockCreditQuotaToUser.mockResolvedValue({
      success: false,
      uncertain: true,
      message: '充值结果不确定，请稍后检查余额',
    });

    const notification: NotificationItem = {
      id: notificationId,
      userId,
      type: 'reward',
      title: '额度奖励',
      content: '领取额度',
      createdAt: Date.now(),
      data: {
        rewardBatchId: batchId,
        rewardType: 'quota',
        rewardAmount: 2,
        claimStatus: 'pending',
      },
    };

    const result = await claimReward(userId, notificationId, notification);

    expect(result.success).toBe(true);
    expect(result.claimStatus).toBe('claimed');
    expect(result.message).toContain('不确定');

    const updatedClaim = kvStore.get(claimKey) as RewardClaim;
    expect(updatedClaim.status).toBe('claimed');
    expect(updatedClaim.failReason).toContain('不确定');

    const updatedBatch = kvStore.get(batchKey) as RewardBatch;
    expect(updatedBatch.claimedCount).toBe(1);
    expect(updatedBatch.failedClaimCount).toBe(0);
  });

  it('rebuilds missing claim from notification and uses longer claim lock ttl', async () => {
    const batchId = 'batch-rebuild';
    const userId = 202;
    const notificationId = 'n-rebuild';
    const claimKey = `rewards:claim:${batchId}:${userId}`;
    const lockKey = `rewards:claim:lock:${batchId}:${userId}`;
    const batchKey = `rewards:batch:${batchId}`;

    kvStore.set(batchKey, {
      id: batchId,
      type: 'points',
      amount: 88,
      targetMode: 'selected',
      targetUserIds: [userId],
      title: '积分奖励',
      message: '领取积分',
      createdBy: 'admin',
      createdAt: Date.now(),
      status: 'completed',
      totalTargets: 1,
      distributedCount: 1,
      claimedCount: 0,
      failedClaimCount: 0,
    } satisfies RewardBatch);

    const notification: NotificationItem = {
      id: notificationId,
      userId,
      type: 'reward',
      title: '积分奖励',
      content: '领取积分',
      createdAt: Date.now(),
      data: {
        rewardBatchId: batchId,
        rewardType: 'points',
        rewardAmount: 88,
        claimStatus: 'pending',
      },
    };

    const result = await claimReward(userId, notificationId, notification);

    expect(result.success).toBe(true);
    expect(result.claimStatus).toBe('claimed');

    const lockCall = mockKvSet.mock.calls.find((call) => call[0] === lockKey);
    expect(lockCall).toBeDefined();
    expect(lockCall?.[2]).toMatchObject({ ex: 120, nx: true });

    const rebuiltClaim = kvStore.get(claimKey) as RewardClaim;
    expect(rebuiltClaim.status).toBe('claimed');
    expect(rebuiltClaim.amount).toBe(88);
  });
});
