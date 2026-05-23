// 福利商店「提现 / 充值」业务流程
//
// 与 wallet-rules.ts 配套：规则与计算放在 wallet-rules.ts（前后端共享），
// 这里只承担副作用：扣加积分、调 new-api 加减额度、失败回滚。

import { applyPointsDelta, deductPoints, getUserPoints } from './points';
import { creditQuotaToUser, deductQuotaFromUser } from './new-api';
import {
  MIN_TOPUP_DOLLARS,
  MIN_WITHDRAW_POINTS,
  POINTS_PER_DOLLAR,
  WITHDRAW_FEE_TIERS,
  getWithdrawFeeRate,
  previewTopup,
  previewWithdraw,
} from './wallet-rules';

export {
  MIN_TOPUP_DOLLARS,
  MIN_WITHDRAW_POINTS,
  POINTS_PER_DOLLAR,
  WITHDRAW_FEE_TIERS,
  getWithdrawFeeRate,
  previewTopup,
  previewWithdraw,
};

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

/**
 * 执行积分提现（积分 → 账户额度）
 * 顺序：扣积分 → 调 new-api 加额度；明确失败则把积分退回；
 *      若 new-api 处于 uncertain 态，保留扣积分并提示用户稍后核对。
 */
export async function executeWithdraw(
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

  const deductResult = await deductPoints(
    userId,
    preview.deducted,
    'exchange_withdraw',
    description,
  );
  if (!deductResult.success) {
    return {
      success: false,
      message: deductResult.message ?? '扣减积分失败',
      balance: deductResult.balance,
    };
  }

  const creditResult = await creditQuotaToUser(userId, preview.dollars);

  if (creditResult.success) {
    return {
      success: true,
      message: `已成功提现 ${preview.deducted} 积分至账户额度，到账 $${preview.dollars}`,
      balance: deductResult.balance,
      dollars: preview.dollars,
      feePoints: preview.feePoints,
    };
  }

  if (creditResult.uncertain) {
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
  const preview = previewTopup(dollars);
  if (!preview.ok) {
    return { success: false, message: preview.message ?? '参数无效' };
  }

  const deductResult = await deductQuotaFromUser(userId, preview.spentDollars);

  if (!deductResult.success && !deductResult.uncertain) {
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
      return {
        success: false,
        message: `${grantResult.message ?? '积分入账失败'}（${rollbackHint}）`,
      };
    }
    return {
      success: false,
      message: '充值失败：积分入账与额度扣减状态均不确定，请稍后核对账户余额',
      uncertain: true,
    };
  }

  if (deductResult.uncertain) {
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

  return {
    success: true,
    message: `成功用 $${preview.spentDollars} 充值 ${preview.pointsGained} 积分`,
    balance: grantResult.balance,
    pointsGained: preview.pointsGained,
    newApiBalanceDollars: deductResult.newBalanceDollars,
    newApiBalanceWholeDollars: deductResult.newBalanceWholeDollars,
  };
}
