import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPointsDelta, deductPoints, getUserPoints } from '../points';
import { creditQuotaToUser, deductQuotaFromUser, getNewApiQuotaBalanceForUser } from '../new-api';
import { createUserNotification } from '../notifications';
import { executeTopup, executeWithdraw } from '../wallet';

const kvMock = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  lpush: vi.fn(),
  lrange: vi.fn(),
  ltrim: vi.fn(),
}));

const withKvLockMock = vi.hoisted(() => vi.fn(
  async (_key: string, handler: () => Promise<unknown>) => handler(),
));

vi.mock('@/lib/d1-kv', () => ({
  kv: kvMock,
}));

vi.mock('../economy-lock', () => ({
  withKvLock: withKvLockMock,
}));

vi.mock('../points', () => ({
  getUserPoints: vi.fn(),
  deductPoints: vi.fn(),
  applyPointsDelta: vi.fn(),
}));

vi.mock('../new-api', () => ({
  creditQuotaToUser: vi.fn(),
  deductQuotaFromUser: vi.fn(),
  getNewApiQuotaBalanceForUser: vi.fn(),
}));

vi.mock('../notifications', () => ({
  createUserNotification: vi.fn(),
}));

describe('wallet notifications', () => {
  const mockGetUserPoints = vi.mocked(getUserPoints);
  const mockDeductPoints = vi.mocked(deductPoints);
  const mockApplyPointsDelta = vi.mocked(applyPointsDelta);
  const mockCreditQuotaToUser = vi.mocked(creditQuotaToUser);
  const mockDeductQuotaFromUser = vi.mocked(deductQuotaFromUser);
  const mockGetNewApiQuotaBalanceForUser = vi.mocked(getNewApiQuotaBalanceForUser);
  const mockCreateUserNotification = vi.mocked(createUserNotification);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mockGetUserPoints.mockResolvedValue(1000);
    mockDeductPoints.mockResolvedValue({ success: true, balance: 900 });
    mockApplyPointsDelta.mockResolvedValue({ success: true, balance: 130 });
    mockCreditQuotaToUser.mockResolvedValue({ success: true, message: 'ok' });
    mockDeductQuotaFromUser.mockResolvedValue({
      success: true,
      message: 'ok',
      newBalanceDollars: 7,
      newBalanceWholeDollars: 7,
    });
    mockGetNewApiQuotaBalanceForUser.mockResolvedValue({
      success: false,
      message: 'balance unavailable',
    });
    mockCreateUserNotification.mockResolvedValue({
      id: 'notification_1',
      userId: 1001,
      type: 'wallet',
      title: '钱包通知',
      content: '钱包通知内容',
      createdAt: 1700000000000,
    });

    kvMock.set.mockResolvedValue('OK');
    kvMock.get.mockResolvedValue(null);
    kvMock.lpush.mockResolvedValue(1);
    kvMock.lrange.mockResolvedValue([]);
    kvMock.ltrim.mockResolvedValue(undefined);
    withKvLockMock.mockImplementation(async (_key: string, handler: () => Promise<unknown>) => handler());
  });

  it('creates a wallet notification after confirmed withdraw success', async () => {
    const result = await executeWithdraw(1001, 100);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(900);
    expect(result.dollars).toBe(9.7);
    expect(withKvLockMock).toHaveBeenCalledWith(
      'lock:user:wallet:1001',
      expect.any(Function),
      expect.objectContaining({ ttlSeconds: 60 }),
    );
    expect(kvMock.set).toHaveBeenCalledWith(
      expect.stringMatching(/^wallet:transaction:/),
      expect.objectContaining({
        operation: 'withdraw',
        status: 'success',
        pointsDelta: -100,
        dollarsDelta: 9.7,
      }),
    );
    expect(mockCreateUserNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateUserNotification).toHaveBeenCalledWith({
      userId: 1001,
      type: 'wallet',
      title: '提现成功到账',
      content: expect.stringContaining('实际到账 $9.7'),
      data: expect.objectContaining({
        kind: 'wallet_withdraw',
        operation: 'withdraw',
        points: 100,
        feePoints: 3,
        netPoints: 97,
        dollars: 9.7,
        balance: 900,
      }),
    });
  });

  it('refunds points when withdraw quota delivery is uncertain and cannot be confirmed', async () => {
    mockCreditQuotaToUser.mockResolvedValueOnce({
      success: false,
      message: '充值结果不确定',
      previousQuota: 1000,
      expectedQuota: 2000,
      quotaDelta: 1000,
      uncertain: true,
    });
    mockApplyPointsDelta.mockResolvedValueOnce({ success: true, balance: 1000 });

    const result = await executeWithdraw(1001, 100);

    expect(result.success).toBe(false);
    expect(result.uncertain).toBeFalsy();
    expect(mockApplyPointsDelta).toHaveBeenCalledWith(
      1001,
      100,
      'exchange_refund',
      expect.stringContaining('提现异常自动退款'),
    );
    expect(kvMock.set).toHaveBeenCalledWith(
      expect.stringMatching(/^wallet:transaction:/),
      expect.objectContaining({
        operation: 'withdraw',
        status: 'failed',
        pointsDelta: -100,
        dollarsDelta: 9.7,
        message: expect.stringContaining('已自动退回'),
      }),
    );
  });

  it('creates a wallet notification after confirmed topup success', async () => {
    const result = await executeTopup(1001, 3);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(130);
    expect(result.pointsGained).toBe(30);
    expect(kvMock.set).toHaveBeenCalledWith(
      expect.stringMatching(/^wallet:transaction:/),
      expect.objectContaining({
        operation: 'topup',
        status: 'success',
        pointsDelta: 30,
        dollarsDelta: -3,
      }),
    );
    expect(mockApplyPointsDelta).toHaveBeenCalledWith(
      1001,
      30,
      'exchange_topup',
      '账户额度充值：扣 $3 兑换 30 积分',
    );
    expect(mockCreateUserNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateUserNotification).toHaveBeenCalledWith({
      userId: 1001,
      type: 'wallet',
      title: '充值成功到账',
      content: '你使用 $3 充值的 30 积分已到账。',
      data: expect.objectContaining({
        kind: 'wallet_topup',
        operation: 'topup',
        dollars: 3,
        pointsGained: 30,
        balance: 130,
        newApiBalanceDollars: 7,
        newApiBalanceWholeDollars: 7,
      }),
    });
  });

  it('does not grant points when topup quota deduct is uncertain and cannot be confirmed', async () => {
    mockDeductQuotaFromUser.mockResolvedValue({
      success: false,
      message: '扣减结果待确认',
      previousQuota: 5000,
      expectedQuota: 3500,
      quotaDelta: -1500,
      uncertain: true,
    });

    const result = await executeTopup(1001, 3);

    expect(result.success).toBe(false);
    expect(result.uncertain).toBe(true);
    expect(mockApplyPointsDelta).not.toHaveBeenCalled();
    expect(kvMock.set).toHaveBeenCalledWith(
      expect.stringMatching(/^wallet:transaction:/),
      expect.objectContaining({
        operation: 'topup',
        status: 'uncertain',
        pointsDelta: 30,
        dollarsDelta: -3,
      }),
    );
    expect(kvMock.lpush).toHaveBeenCalledWith(
      'wallet:uncertain:1001',
      expect.any(String),
    );
    expect(mockCreateUserNotification).not.toHaveBeenCalled();
  });

  it('keeps withdraw successful when wallet notification creation fails', async () => {
    mockCreateUserNotification.mockRejectedValueOnce(new Error('notify failed'));

    const result = await executeWithdraw(1001, 100);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(900);
    expect(mockCreateUserNotification).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      'Create wallet notification failed:',
      expect.objectContaining({
        operation: 'withdraw',
        error: expect.any(Error),
      }),
    );
  });
});
