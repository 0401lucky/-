// 福利商店「提现 / 充值」业务流程
//
// 与 wallet-rules.ts 配套：规则与计算放在 wallet-rules.ts（前后端共享），
// 这里只承担副作用：扣加积分、调 new-api 加减额度、失败回滚。

import { kv } from '@/lib/d1-kv';
import { nanoid } from 'nanoid';
import { applyPointsDelta, deductPoints, getUserPoints } from './points';
import { creditQuotaToUser, deductQuotaFromUser, getNewApiQuotaBalanceForUser } from './new-api';
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
  previousQuota?: number;
  expectedQuota?: number;
  quotaDelta?: number;
  pointsApplied?: boolean;
  compensatedAt?: number;
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

function isQuotaConfirmedIncreased(record: Pick<WalletTransactionRecord, 'expectedQuota'>, quota: number | undefined): boolean {
  return typeof record.expectedQuota === 'number'
    && typeof quota === 'number'
    && quota >= record.expectedQuota;
}

function isQuotaConfirmedNotIncreased(record: Pick<WalletTransactionRecord, 'previousQuota'>, quota: number | undefined): boolean {
  return typeof record.previousQuota === 'number'
    && typeof quota === 'number'
    && quota <= record.previousQuota;
}

function isQuotaConfirmedDeducted(record: Pick<WalletTransactionRecord, 'expectedQuota'>, quota: number | undefined): boolean {
  return typeof record.expectedQuota === 'number'
    && typeof quota === 'number'
    && quota <= record.expectedQuota;
}

function isQuotaConfirmedNotDeducted(record: Pick<WalletTransactionRecord, 'previousQuota'>, quota: number | undefined): boolean {
  return typeof record.previousQuota === 'number'
    && typeof quota === 'number'
    && quota >= record.previousQuota;
}

async function refundWithdrawPoints(
  record: WalletTransactionRecord,
  reason: string,
): Promise<{ success: boolean; balance?: number; message: string }> {
  const refundPoints = Math.abs(record.pointsDelta);
  if (refundPoints <= 0) {
    return { success: true, message: '无需退回积分' };
  }

  const refund = await applyPointsDelta(
    record.userId,
    refundPoints,
    'exchange_refund',
    `提现异常自动退款：${reason}`,
  );

  await updateWalletTransaction(record, {
    status: refund.success ? 'failed' : 'uncertain',
    message: refund.success
      ? `${reason}，已自动退回 ${refundPoints} 积分`
      : `${reason}，自动退款失败：${refund.message ?? '未知错误'}`,
    compensatedAt: refund.success ? Date.now() : undefined,
  });

  return {
    success: refund.success,
    balance: refund.balance,
    message: refund.success
      ? `${reason}，已自动退回积分`
      : `${reason}，自动退款失败，请联系管理员`,
  };
}

async function resolveWithdrawUncertain(
  record: WalletTransactionRecord,
  fallbackMessage: string,
): Promise<WithdrawResult> {
  const quota = await getNewApiQuotaBalanceForUser(record.userId);

  if (quota.success && isQuotaConfirmedIncreased(record, quota.quota)) {
    await updateWalletTransaction(record, {
      status: 'success',
      message: '提现到账已自动确认',
      newApiBalanceDollars: quota.balanceDollars,
      newApiBalanceWholeDollars: quota.balanceWholeDollars,
    });
    return {
      success: true,
      message: '提现到账已自动确认',
      balance: await getUserPoints(record.userId),
      dollars: record.requestedDollars ?? Math.max(0, record.dollarsDelta),
      feePoints: record.feePoints,
    };
  }

  if (!quota.success || isQuotaConfirmedNotIncreased(record, quota.quota)) {
    const refund = await refundWithdrawPoints(record, fallbackMessage);
    return {
      success: false,
      message: refund.message,
      balance: refund.balance,
      dollars: record.requestedDollars ?? Math.max(0, record.dollarsDelta),
      feePoints: record.feePoints,
      uncertain: !refund.success,
    };
  }

  await updateWalletTransaction(record, {
    status: 'uncertain',
    message: fallbackMessage,
    newApiBalanceDollars: quota.balanceDollars,
    newApiBalanceWholeDollars: quota.balanceWholeDollars,
  });
  return {
    success: false,
    message: `${fallbackMessage}，系统仍在自动核对，请稍后刷新。`,
    balance: await getUserPoints(record.userId),
    dollars: record.requestedDollars ?? Math.max(0, record.dollarsDelta),
    feePoints: record.feePoints,
    uncertain: true,
  };
}

async function resolveTopupUncertainBeforeGrant(
  record: WalletTransactionRecord,
): Promise<'deducted' | 'not_deducted' | 'unknown'> {
  const quota = await getNewApiQuotaBalanceForUser(record.userId);
  if (!quota.success) return 'unknown';
  if (isQuotaConfirmedDeducted(record, quota.quota)) return 'deducted';
  if (isQuotaConfirmedNotDeducted(record, quota.quota)) return 'not_deducted';
  return 'unknown';
}

export async function recoverWalletTransactions(userId: number, limit = 20): Promise<void> {
  const ids = await kv.lrange<string>(WALLET_UNCERTAIN_LIST_KEY(userId), 0, Math.max(0, limit - 1));
  for (const id of ids ?? []) {
    const record = await kv.get<WalletTransactionRecord>(WALLET_TRANSACTION_KEY(id));
    if (!record || record.userId !== userId || record.status !== 'uncertain') continue;

    if (record.operation === 'withdraw') {
      await resolveWithdrawUncertain(record, record.message || '提现未确认到账');
      continue;
    }

    const quotaState = await resolveTopupUncertainBeforeGrant(record);
    if (quotaState === 'not_deducted') {
      if (record.pointsApplied && record.pointsDelta > 0) {
        const rollback = await applyPointsDelta(
          userId,
          -record.pointsDelta,
          'exchange_refund',
          `充值异常自动回滚积分：额度未扣减，交易 ${record.id}`,
        );
        await updateWalletTransaction(record, {
          status: rollback.success ? 'failed' : 'uncertain',
          message: rollback.success ? '额度未扣减，已自动回滚积分' : '额度未扣减，但积分回滚失败',
          compensatedAt: rollback.success ? Date.now() : undefined,
        });
      } else {
        await updateWalletTransaction(record, {
          status: 'failed',
          message: '额度未扣减，充值已自动关闭',
          compensatedAt: Date.now(),
        });
      }
      continue;
    }

    if (quotaState === 'deducted' && !record.pointsApplied && record.pointsDelta > 0) {
      const grant = await applyPointsDelta(
        userId,
        record.pointsDelta,
        'exchange_topup',
        `充值异常自动补发积分：交易 ${record.id}`,
      );
      await updateWalletTransaction(record, {
        status: grant.success ? 'success' : 'uncertain',
        message: grant.success ? '额度已扣减，积分已自动补发' : '额度已扣减，积分自动补发失败',
        pointsApplied: grant.success,
        compensatedAt: grant.success ? Date.now() : undefined,
      });
    }
  }
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
    previousQuota: undefined,
    expectedQuota: undefined,
    quotaDelta: undefined,
    pointsApplied: true,
    requestedPoints: preview.deducted,
    requestedDollars: preview.dollars,
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
  const transactionWithQuota: WalletTransactionRecord = {
    ...transaction,
    previousQuota: creditResult.previousQuota,
    expectedQuota: creditResult.expectedQuota,
    quotaDelta: creditResult.quotaDelta,
  };

  if (creditResult.success) {
    await updateWalletTransaction(transactionWithQuota, {
      status: 'success',
      message: creditResult.message || '提现成功到账',
      previousQuota: creditResult.previousQuota,
      expectedQuota: creditResult.expectedQuota,
      quotaDelta: creditResult.quotaDelta,
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
    await updateWalletTransaction(transactionWithQuota, {
      status: 'uncertain',
      message: creditResult.message || '提现额度入账结果不确定',
      previousQuota: creditResult.previousQuota,
      expectedQuota: creditResult.expectedQuota,
      quotaDelta: creditResult.quotaDelta,
      newApiBalanceDollars: creditResult.newBalanceDollars,
      newApiBalanceWholeDollars: creditResult.newBalanceWholeDollars,
    });

    return resolveWithdrawUncertain(
      transactionWithQuota,
      creditResult.message || '提现额度入账结果不确定',
    );
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
    pointsApplied: false,
    message: `账户额度充值：扣 $${preview.spentDollars} 兑换 ${preview.pointsGained} 积分`,
  });
  if (!transaction) {
    return { success: false, message: '交易记录创建失败，请稍后重试' };
  }

  const deductResult = await deductQuotaFromUser(userId, preview.spentDollars);
  const transactionWithQuota: WalletTransactionRecord = {
    ...transaction,
    previousQuota: deductResult.previousQuota,
    expectedQuota: deductResult.expectedQuota,
    quotaDelta: deductResult.quotaDelta,
  };

  if (!deductResult.success && !deductResult.uncertain) {
    await updateWalletTransaction(transactionWithQuota, {
      status: 'failed',
      message: deductResult.message || '账户额度扣减失败',
      previousQuota: deductResult.previousQuota,
      expectedQuota: deductResult.expectedQuota,
      quotaDelta: deductResult.quotaDelta,
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

  if (deductResult.uncertain) {
    const quotaState = await resolveTopupUncertainBeforeGrant(transactionWithQuota);
    if (quotaState === 'not_deducted') {
      await updateWalletTransaction(transactionWithQuota, {
        status: 'failed',
        message: deductResult.message || '账户额度未扣减，充值已自动关闭',
        newApiBalanceDollars: deductResult.newBalanceDollars,
        newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
        compensatedAt: Date.now(),
      });
      return {
        success: false,
        message: deductResult.message || '账户额度未扣减，充值已自动关闭',
        newApiBalanceDollars: deductResult.newBalanceDollars,
        newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
      };
    }

    if (quotaState === 'unknown') {
      await updateWalletTransaction(transactionWithQuota, {
        status: 'uncertain',
        message: deductResult.message || '账户额度扣减结果待确认，暂不发放积分',
        newApiBalanceDollars: deductResult.newBalanceDollars,
        newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
      });
      return {
        success: false,
        message: '账户额度扣减结果待确认，系统会自动核对并在确认扣减后补发积分',
        newApiBalanceDollars: deductResult.newBalanceDollars,
        newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
        uncertain: true,
      };
    }
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
      await updateWalletTransaction(transactionWithQuota, {
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
    await updateWalletTransaction(transactionWithQuota, {
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
    await updateWalletTransaction(transactionWithQuota, {
      status: 'success',
      message: '账户额度扣减已自动确认，积分已入账',
      newApiBalanceDollars: deductResult.newBalanceDollars,
      newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
      pointsApplied: true,
    });

    return {
      success: true,
      message: `已确认账户额度扣减，并为您加上 ${preview.pointsGained} 积分`,
      balance: grantResult.balance,
      pointsGained: preview.pointsGained,
      newApiBalanceDollars: deductResult.newBalanceDollars,
      newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
    };
  }

  await updateWalletTransaction(transactionWithQuota, {
    status: 'success',
    message: deductResult.message || '充值成功到账',
    newApiBalanceDollars: deductResult.newBalanceDollars,
    newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
    pointsApplied: true,
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
