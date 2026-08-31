import { describe, expect, it } from 'vitest';

import { MIN_WITHDRAW_POINTS, previewWithdraw } from '@/lib/wallet-rules';

/**
 * 与 backend/internal/economy/wallet_test.go 的 walletPreviewVectors 完全同源。
 * 修改任何一边都必须同步另一边 —— 两份实现的浮点表达式必须逐字对齐。
 */
const VECTORS = [
  { name: 'min tier', points: 10, feePercent: 100, feePoints: 1, netPoints: 9, feeRate: 0.05, dollars: 0.9 },
  { name: 'hundred tier', points: 100, feePercent: 100, feePoints: 3, netPoints: 97, feeRate: 0.03, dollars: 9.7 },
  { name: 'thousand tier', points: 1000, feePercent: 100, feePoints: 20, netPoints: 980, feeRate: 0.02, dollars: 98 },
  { name: 'ten thousand tier', points: 10000, feePercent: 100, feePoints: 100, netPoints: 9900, feeRate: 0.01, dollars: 990 },
  { name: 'ceil fee', points: 101, feePercent: 100, feePoints: 4, netPoints: 97, feeRate: 0.03, dollars: 9.7 },
  { name: 'half off min tier stays one', points: 10, feePercent: 50, feePoints: 1, netPoints: 9, feeRate: 0.05, dollars: 0.9 },
  { name: 'half off hundred tier', points: 100, feePercent: 50, feePoints: 2, netPoints: 98, feeRate: 0.03, dollars: 9.8 },
  { name: 'half off thousand tier', points: 1000, feePercent: 50, feePoints: 10, netPoints: 990, feeRate: 0.02, dollars: 99 },
  { name: 'half off ten thousand tier', points: 10000, feePercent: 50, feePoints: 50, netPoints: 9950, feeRate: 0.01, dollars: 995 },
  { name: 'half off ceil fee', points: 101, feePercent: 50, feePoints: 2, netPoints: 99, feeRate: 0.03, dollars: 9.9 },
  { name: 'zero percent min tier', points: 10, feePercent: 0, feePoints: 0, netPoints: 10, feeRate: 0.05, dollars: 1 },
  { name: 'zero percent ten thousand tier', points: 10000, feePercent: 0, feePoints: 0, netPoints: 10000, feeRate: 0.01, dollars: 1000 },
  // 判别向量：feePercent=28 时被禁的「先除后乘」写法会算出 8，正确的左结合写法算出 7。
  // 这条向量把「两边表达式逐字对齐」从注释约定升级为测试不变量，请勿删除。
  { name: 'order sensitive', points: 1250, feePercent: 28, feePoints: 7, netPoints: 1243, feeRate: 0.02, dollars: 124.3 },
];

describe('previewWithdraw', () => {
  it.each(VECTORS)('$name', ({ points, feePercent, feePoints, netPoints, feeRate, dollars }) => {
    const got = previewWithdraw(points, feePercent);
    expect(got.ok).toBe(true);
    expect(got.deducted).toBe(points);
    expect(got.feePoints).toBe(feePoints);
    expect(got.netPoints).toBe(netPoints);
    expect(got.feeRate).toBe(feeRate);
    expect(got.dollars).toBe(dollars);
  });

  it('默认不打折，与显式传 100 等价', () => {
    expect(previewWithdraw(101)).toEqual(previewWithdraw(101, 100));
  });

  it.each([-1, 0, MIN_WITHDRAW_POINTS - 1, 1.5, Number.NaN])('拒绝非法输入 %s', (points) => {
    expect(previewWithdraw(points).ok).toBe(false);
  });
});
