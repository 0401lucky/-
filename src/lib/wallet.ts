// 福利商店「提现 / 充值」业务流程
//
// 与 wallet-rules.ts 配套：规则与计算放在 wallet-rules.ts（前后端共享），
// 这里只承担副作用：扣加积分、调 new-api 加减额度、失败回滚。

import { kv } from '@/lib/d1-kv';
import { nanoid } from 'nanoid';
import { applyPointsDelta, deductPoints, getUserPoints } from './points';
import { creditQuotaToUser, deductQuotaFromUser } from './new-api';
import { createUserNotification } from './notifications';
import { maskUserId } from './logging';
import { withKvLock } from './economy-lock';
import {
  MIN_TOPUP_DOLLARS,
  MIN_WITHDRAW_POINTS,
  POINTS_PER_DOLLAR,
  WITHDRAW_FEE_TIERS,
  getWithdrawFeeRate,
  previewTopup,
  previewWithdraw,
} from './wallet-rules';

const WALLET_TRANSACTION_KEY = (id: string) => `wallet:transaction:${id}`;
const WALLET_TRANSACTION_LIST_KEY = (userId: number) => `wallet:transactions:${userId}`;
const WALLET_UNCERTAIN_LIST_KEY = (userId: number) => `wallet:uncertain:${userId}`;
const WALLET_OPERATION_LOCK_KEY = (userId: number) => `lock:user:wallet:${userId}`;
const WALLET_LOG_MAX_ENTRIES = 100;
const WALLET_OPERATION_LOCK_TTL_SECONDS = 60;

export {
  MIN_TOPUP_DOLLARS,
  MIN_WITHDRAW_POINTS,
  POINTS_PER_DOLLAR,
  WITHDRAW_FEE_TIERS,
  getWithdrawFeeRate,
  previewTopup,
  previewWithdraw,
};

type WalletOperation = 'withdraw' | 'topup';
type WalletTransactionStatus = 'pending' | 'success' | 'failed' | 'uncertain';

export interface WalletTransactionRecord {
  id: string;
  userId: number;
  operation: WalletOperation;
  status: WalletTransactionStatus;
  /** 本站积分变化：提现为负，充值为正 */
  pointsDelta: number;
  /** new-api 额度变化：提现为正，充值为负 */
  dollarsDelta: number;
  requestedPoints?: number;
  requestedDollars?: number;
  feePoints?: number;
  netPoints?: number;
  message: string;
  newApiBalanceDollars?: number;
  newApiBalanceWholeDollars?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WithdrawResult {
  success: boolean;
  message: string;
  /** 操作后的积分余额 */
  balance?: number;
  /** 实际兑换的美元 */
  dollars?: number;
  /** 手续费积分 */
  feePoints?: number;
  /** 是否处于 new-api 调用结果不确定状态 */
  uncertain?: boolean;
}

async function createWalletNotification(input: {
  userId: number;
  operation: 'withdraw' | 'topup';
  title: string;
  content: string;
  data: Record<string, unknown>;
}): Promise<void> {
  try {
    await createUserNotification({
      userId: input.userId,
      type: 'wallet',
      title: input.title,
      content: input.content,
      data: {
        kind: `wallet_${input.operation}`,
        operation: input.operation,
        ...input.data,
      },
    });
  } catch (error) {
    console.error('Create wallet notification failed:', {
      userId: maskUserId(input.userId),
      operation: input.operation,
      error,
    });
  }
}

async function runWithWalletOperationLock<T extends { success: boolean; message: string }>(
  userId: number,
  operation: WalletOperation,
  handler: () => Promise<T>,
): Promise<T> {
  try {
    return await withKvLock(WALLET_OPERATION_LOCK_KEY(userId), handler, {
      ttlSeconds: WALLET_OPERATION_LOCK_TTL_SECONDS,
      maxRetries: 12,
      retryMs: 120,
      timeoutMessage: 'WALLET_OPERATION_BUSY',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'WALLET_OPERATION_BUSY') {
      return {
        success: false,
        message: operation === 'withdraw'
          ? '已有提现请求正在处理中，请稍后再试'
          : '已有充值请求正在处理中，请稍后再试',
      } as T;
    }

    console.error('Wallet operation lock failed:', {
      userId: maskUserId(userId),
      operation,
      error,
    });
    return {
      success: false,
      message: '系统繁忙，请稍后再试',
    } as T;
  }
}

async function beginWalletTransaction(
  input: Omit<WalletTransactionRecord, 'id' | 'status' | 'createdAt' | 'updatedAt'>,
): Promise<WalletTransactionRecord | null> {
  const now = Date.now();
  const record: WalletTransactionRecord = {
    ...input,
    id: nanoid(),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  try {
    await kv.set(WALLET_TRANSACTION_KEY(record.id), record);
    await kv.lpush(WALLET_TRANSACTION_LIST_KEY(record.userId), record.id);
    await kv.ltrim(WALLET_TRANSACTION_LIST_KEY(record.userId), 0, WALLET_LOG_MAX_ENTRIES - 1);
    return record;
  } catch (error) {
    console.error('Create wallet transaction failed:', {
      userId: maskUserId(record.userId),
      operation: record.operation,
      error,
    });
    return null;
  }
}

async function updateWalletTransaction(
  record: WalletTransactionRecord | null,
  updates: Partial<Omit<WalletTransactionRecord, 'id' | 'userId' | 'operation' | 'createdAt'>>,
): Promise<WalletTransactionRecord | null> {
  if (!record) return null;

  const next: WalletTransactionRecord = {
    ...record,
    ...updates,
    updatedAt: Date.now(),
  };

  try {
    await kv.set(WALLET_TRANSACTION_KEY(next.id), next);
    if (next.status === 'uncertain') {
      await kv.lpush(WALLET_UNCERTAIN_LIST_KEY(next.userId), next.id);
      await kv.ltrim(WALLET_UNCERTAIN_LIST_KEY(next.userId), 0, WALLET_LOG_MAX_ENTRIES - 1);
    }
  } catch (error) {
    console.error('Update wallet transaction failed:', {
      userId: maskUserId(next.userId),
      operation: next.operation,
      transactionId: next.id,
      status: next.status,
      error,
    });
  }

  return next;
}

/**
 * 执行积分提现（积分 → 账户额度）
 * 顺序：扣积分 → 调 new-api 加额度；明确失败则把积分退回；
 *      若 new-api 处于 uncertain 态，保留扣积分并提示用户稍后核对。
 */
export async function executeWithdraw(
  userId: number,
  points: number,
): Promise<WithdrawResult> {
  return runWithWalletOperationLock(userId, 'withdraw', () => executeWithdrawInner(userId, points));
}

async function executeWithdrawInner(
  userId: number,
  points: number,
): Promise<WithdrawResult> {
  const preview = previewWithdraw(points);
  if (!preview.ok) {
    return { success: false, message: preview.message ?? '参数无效' };
  }

  const balance = await getUserPoints(userId);
  if (balance < preview.deducted) {
    return { success: false, message: '积分余额不足', balance };
  }

  const description = `提现 ${preview.deducted} 积分（手续费 ${preview.feePoints}，到账 $${preview.dollars}）`;

  const transaction = await beginWalletTransaction({
    userId,
    operation: 'withdraw',
    pointsDelta: -preview.deducted,
    dollarsDelta: preview.dollars,
    requestedPoints: preview.deducted,
    feePoints: preview.feePoints,
    netPoints: preview.netPoints,
    message: description,
  });
  if (!transaction) {
    return { success: false, message: '交易记录创建失败，请稍后重试', balance };
  }

  const deductResult = await deductPoints(
    userId,
    preview.deducted,
    'exchange_withdraw',
    description,
  );
  if (!deductResult.success) {
    await updateWalletTransaction(transaction, {
      status: 'failed',
      message: deductResult.message ?? '扣减积分失败',
    });
    return {
      success: false,
      message: deductResult.message ?? '扣减积分失败',
      balance: deductResult.balance,
    };
  }

  const creditResult = await creditQuotaToUser(userId, preview.dollars);

  if (creditResult.success) {
    await updateWalletTransaction(transaction, {
      status: 'success',
      message: creditResult.message || '提现成功到账',
      newApiBalanceDollars: creditResult.newBalanceDollars,
      newApiBalanceWholeDollars: creditResult.newBalanceWholeDollars,
    });

    await createWalletNotification({
      userId,
      operation: 'withdraw',
      title: '提现成功到账',
      content: `你提交的 ${preview.deducted} 积分提现已处理成功，扣除手续费 ${preview.feePoints} 积分，实际到账 $${preview.dollars}。`,
      data: {
        points: preview.deducted,
        feePoints: preview.feePoints,
        netPoints: preview.netPoints,
        dollars: preview.dollars,
        balance: deductResult.balance,
      },
    });

    return {
      success: true,
      message: `已成功提现 ${preview.deducted} 积分至账户额度，到账 $${preview.dollars}`,
      balance: deductResult.balance,
      dollars: preview.dollars,
      feePoints: preview.feePoints,
    };
  }

  if (creditResult.uncertain) {
    await updateWalletTransaction(transaction, {
      status: 'uncertain',
      message: creditResult.message || '提现额度入账结果不确定',
      newApiBalanceDollars: creditResult.newBalanceDollars,
      newApiBalanceWholeDollars: creditResult.newBalanceWholeDollars,
    });

    return {
      success: false,
      message: `提现请求已受理，但额度入账结果暂不确定，请稍后查看新 API 余额。${creditResult.message ?? ''}`.trim(),
      balance: deductResult.balance,
      dollars: preview.dollars,
      feePoints: preview.feePoints,
      uncertain: true,
    };
  }

  // 加额度明确失败：退回积分
  const refund = await applyPointsDelta(
    userId,
    preview.deducted,
    'exchange_refund',
    `提现失败回滚：${creditResult.message ?? '账户额度入账失败'}`,
  );

  await updateWalletTransaction(transaction, {
    status: refund.success ? 'failed' : 'uncertain',
    message: refund.success
      ? (creditResult.message || '账户额度入账失败，已退回积分')
      : `账户额度入账失败，且积分回滚失败：${refund.message ?? '未知错误'}`,
  });

  return {
    success: false,
    message: creditResult.message || '账户额度入账失败，已退回积分',
    balance: refund.success ? refund.balance : deductResult.balance,
  };
}

export interface TopupResult {
  success: boolean;
  message: string;
  balance?: number;
  pointsGained?: number;
  newApiBalanceDollars?: number;
  newApiBalanceWholeDollars?: number;
  uncertain?: boolean;
}

/**
 * 执行额度充值（账户额度 → 积分）
 * 顺序：扣 new-api 额度 → 加积分；积分加成功视为整体成功；
 *      若额度处于 uncertain 但积分加成功，整体成功并提示稍后核对。
 */
export async function executeTopup(
  userId: number,
  dollars: number,
): Promise<TopupResult> {
  return runWithWalletOperationLock(userId, 'topup', () => executeTopupInner(userId, dollars));
}

async function executeTopupInner(
  userId: number,
  dollars: number,
): Promise<TopupResult> {
  const preview = previewTopup(dollars);
  if (!preview.ok) {
    return { success: false, message: preview.message ?? '参数无效' };
  }

  const transaction = await beginWalletTransaction({
    userId,
    operation: 'topup',
    pointsDelta: preview.pointsGained,
    dollarsDelta: -preview.spentDollars,
    requestedDollars: preview.spentDollars,
    message: `账户额度充值：扣 $${preview.spentDollars} 兑换 ${preview.pointsGained} 积分`,
  });
  if (!transaction) {
    return { success: false, message: '交易记录创建失败，请稍后重试' };
  }

  const deductResult = await deductQuotaFromUser(userId, preview.spentDollars);

  if (!deductResult.success && !deductResult.uncertain) {
    await updateWalletTransaction(transaction, {
      status: 'failed',
      message: deductResult.message || '账户额度扣减失败',
      newApiBalanceDollars: deductResult.newBalanceDollars,
      newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
    });

    return {
      success: false,
      message: deductResult.message || '账户额度扣减失败',
      newApiBalanceDollars: deductResult.newBalanceDollars,
      newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
    };
  }

  const grantResult = await applyPointsDelta(
    userId,
    preview.pointsGained,
    'exchange_topup',
    `账户额度充值：扣 $${preview.spentDollars} 兑换 ${preview.pointsGained} 积分`,
  );

  if (!grantResult.success) {
    if (deductResult.success) {
      const rollback = await creditQuotaToUser(userId, preview.spentDollars);
      const rollbackHint = rollback.success
        ? '已自动退回账户额度'
        : '额度退回失败，请联系管理员';
      await updateWalletTransaction(transaction, {
        status: rollback.success ? 'failed' : 'uncertain',
        message: `${grantResult.message ?? '积分入账失败'}（${rollbackHint}）`,
        newApiBalanceDollars: rollback.newBalanceDollars,
        newApiBalanceWholeDollars: rollback.newBalanceWholeDollars,
      });
      return {
        success: false,
        message: `${grantResult.message ?? '积分入账失败'}（${rollbackHint}）`,
      };
    }
    await updateWalletTransaction(transaction, {
      status: 'uncertain',
      message: '充值失败：积分入账与额度扣减状态均不确定',
      newApiBalanceDollars: deductResult.newBalanceDollars,
      newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
    });
    return {
      success: false,
      message: '充值失败：积分入账与额度扣减状态均不确定，请稍后核对账户余额',
      uncertain: true,
    };
  }

  if (deductResult.uncertain) {
    await updateWalletTransaction(transaction, {
      status: 'uncertain',
      message: deductResult.message || '账户额度扣减结果待确认，积分已入账',
      newApiBalanceDollars: deductResult.newBalanceDollars,
      newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
    });

    return {
      success: true,
      message: `已为您加上 ${preview.pointsGained} 积分；账户额度扣减结果待确认，请稍后核对新 API 余额`,
      balance: grantResult.balance,
      pointsGained: preview.pointsGained,
      newApiBalanceDollars: deductResult.newBalanceDollars,
      newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
      uncertain: true,
    };
  }

  await updateWalletTransaction(transaction, {
    status: 'success',
    message: deductResult.message || '充值成功到账',
    newApiBalanceDollars: deductResult.newBalanceDollars,
    newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
  });

  await createWalletNotification({
    userId,
    operation: 'topup',
    title: '充值成功到账',
    content: `你使用 $${preview.spentDollars} 充值的 ${preview.pointsGained} 积分已到账。`,
    data: {
      dollars: preview.spentDollars,
      pointsGained: preview.pointsGained,
      balance: grantResult.balance,
      newApiBalanceDollars: deductResult.newBalanceDollars,
      newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
    },
  });

  return {
    success: true,
    message: `成功用 $${preview.spentDollars} 充值 ${preview.pointsGained} 积分`,
    balance: grantResult.balance,
    pointsGained: preview.pointsGained,
    newApiBalanceDollars: deductResult.newBalanceDollars,
    newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
  };
}
