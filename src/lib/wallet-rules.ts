// 福利商店 提现/充值 规则与纯计算
//
// 此模块仅包含常量与纯函数，不依赖任何 server-only 资源；
// 后端 wallet.ts 与前端 store 页面共用同一份规则实现。

/** 1 美元等价的积分数量（双向通用） */
export const POINTS_PER_DOLLAR = 10;
/** 提现最低积分门槛 */
export const MIN_WITHDRAW_POINTS = 10;
/** 充值最低美元金额 */
export const MIN_TOPUP_DOLLARS = 1;

export interface WithdrawTier {
  /** 申请提现积分下限（含） */
  min: number;
  /** 手续费率，0-1 之间 */
  rate: number;
}

/** 阶梯手续费表，按下限从高到低排列 */
export const WITHDRAW_FEE_TIERS: WithdrawTier[] = [
  { min: 10000, rate: 0.01 },
  { min: 1000, rate: 0.02 },
  { min: 100, rate: 0.03 },
  { min: MIN_WITHDRAW_POINTS, rate: 0.05 },
];

/** 根据申请的积分量返回适用费率 */
export function getWithdrawFeeRate(points: number): number {
  for (const tier of WITHDRAW_FEE_TIERS) {
    if (points >= tier.min) return tier.rate;
  }
  return 0;
}

export interface WithdrawPreview {
  ok: boolean;
  message?: string;
  /** 实际从积分余额中扣除的总积分（= points） */
  deducted: number;
  /** 手续费扣除的积分 */
  feePoints: number;
  /** 净换算积分（参与转换为美元的部分） */
  netPoints: number;
  /** 当前适用费率 */
  feeRate: number;
  /** 实际兑换得到的美元（保留两位小数） */
  dollars: number;
}

/**
 * 计算提现的预览（不修改任何状态）
 * - points 必须为正整数
 * - 手续费向上取整，避免给系统留零头损失
 */
export function previewWithdraw(points: number): WithdrawPreview {
  const empty: WithdrawPreview = {
    ok: false,
    deducted: 0,
    feePoints: 0,
    netPoints: 0,
    feeRate: 0,
    dollars: 0,
  };

  if (!Number.isFinite(points) || !Number.isInteger(points) || points <= 0) {
    return { ...empty, message: '积分数量必须为正整数' };
  }
  if (points < MIN_WITHDRAW_POINTS) {
    return { ...empty, message: `最低提现 ${MIN_WITHDRAW_POINTS} 积分` };
  }

  const feeRate = getWithdrawFeeRate(points);
  const feePoints = Math.ceil(points * feeRate);
  const netPoints = Math.max(0, points - feePoints);
  // 美元值精确到 0.01，避免浮点误差
  const dollars = Math.round((netPoints / POINTS_PER_DOLLAR) * 100) / 100;

  return {
    ok: true,
    deducted: points,
    feePoints,
    netPoints,
    feeRate,
    dollars,
  };
}

export interface TopupPreview {
  ok: boolean;
  message?: string;
  /** 扣减的美元金额（取整数美元） */
  spentDollars: number;
  /** 充值得到的积分 */
  pointsGained: number;
}

/** 计算充值预览（无手续费） */
export function previewTopup(dollars: number): TopupPreview {
  const empty: TopupPreview = { ok: false, spentDollars: 0, pointsGained: 0 };

  if (!Number.isFinite(dollars) || dollars <= 0) {
    return { ...empty, message: '充值金额必须为正数' };
  }
  // 简化为整数美元，避免浮点累计误差
  const intDollars = Math.floor(dollars);
  if (intDollars < MIN_TOPUP_DOLLARS) {
    return { ...empty, message: `最低充值 $${MIN_TOPUP_DOLLARS}` };
  }
  return {
    ok: true,
    spentDollars: intDollars,
    pointsGained: intDollars * POINTS_PER_DOLLAR,
  };
}
