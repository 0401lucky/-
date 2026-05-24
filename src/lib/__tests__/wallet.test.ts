import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPointsDelta, deductPoints, getUserPoints } from '../points';
import { creditQuotaToUser, deductQuotaFromUser } from '../new-api';
import { createUserNotification } from '../notifications';
import { executeTopup, executeWithdraw } from '../wallet';

vi.mock('../points', () => ({
  getUserPoints: vi.fn(),
  deductPoints: vi.fn(),
  applyPointsDelta: vi.fn(),
}));

vi.mock('../new-api', () => ({
  creditQuotaToUser: vi.fn(),
  deductQuotaFromUser: vi.fn(),
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
    mockCreateUserNotification.mockResolvedValue({
      id: 'notification_1',
      userId: 1001,
      type: 'wallet',
      title: '钱包通知',
      content: '钱包通知内容',
      createdAt: 1700000000000,
    });
  });

  it('creates a wallet notification after confirmed withdraw success', async () => {
    const result = await executeWithdraw(1001, 100);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(900);
    expect(result.dollars).toBe(9.7);
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

  it('creates a wallet notification after confirmed topup success', async () => {
    const result = await executeTopup(1001, 3);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(130);
    expect(result.pointsGained).toBe(30);
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

  it('does not create a success notification when topup quota deduct is uncertain', async () => {
    mockDeductQuotaFromUser.mockResolvedValue({
      success: false,
      message: '扣减结果待确认',
      uncertain: true,
    });

    const result = await executeTopup(1001, 3);

    expect(result.success).toBe(true);
    expect(result.uncertain).toBe(true);
    expect(mockApplyPointsDelta).toHaveBeenCalled();
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
