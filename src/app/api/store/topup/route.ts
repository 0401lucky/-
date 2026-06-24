import { NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { executeTopup, MIN_TOPUP_DOLLARS, recoverWalletTransactions } from '@/lib/wallet';
import { getUserPoints } from '@/lib/points';
import {
  NEW_API_QUOTA_PER_DOLLAR,
  getNewApiQuotaBalanceForUser,
} from '@/lib/new-api';

export const dynamic = 'force-dynamic';

export const GET = withUserRateLimit(
  'store:balance',
  async (_request, user) => {
    await recoverWalletTransactions(user.id).catch((error) => {
      console.error('wallet balance recovery failed:', error);
    });

    const result = await getNewApiQuotaBalanceForUser(user.id);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      data: {
        newApiQuota: result.quota,
        newApiUsedQuota: result.usedQuota,
        newApiBalanceDollars: result.balanceDollars,
        newApiBalanceWholeDollars: result.balanceWholeDollars,
        quotaPerDollar: NEW_API_QUOTA_PER_DOLLAR,
      },
    });
  },
  { unauthorizedMessage: '请先登录' },
);

// POST /api/store/topup
// body: { dollars: number }
// 用账户额度兑换积分（无手续费，$1 = 10 积分）
export const POST = withUserRateLimit(
  'store:exchange',
  async (request, user) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: '请求体格式无效' },
        { status: 400 },
      );
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, message: '请求体格式无效' },
        { status: 400 },
      );
    }

    const raw = (body as Record<string, unknown>).dollars;
    const dollars = Number(raw);

    if (!Number.isFinite(dollars) || dollars <= 0) {
      return NextResponse.json(
        { success: false, message: '充值金额必须为正数' },
        { status: 400 },
      );
    }
    if (dollars < MIN_TOPUP_DOLLARS) {
      return NextResponse.json(
        { success: false, message: `最低充值 $${MIN_TOPUP_DOLLARS}` },
        { status: 400 },
      );
    }

    await recoverWalletTransactions(user.id).catch((error) => {
      console.error('wallet topup recovery failed:', error);
    });

    const result = await executeTopup(user.id, dollars);

    const balance = result.balance ?? (await getUserPoints(user.id));

    if (!result.success && !result.uncertain) {
      return NextResponse.json(
        {
          success: false,
          message: result.message,
          data: {
            newBalance: balance,
            newApiBalanceDollars: result.newApiBalanceDollars,
            newApiBalanceWholeDollars: result.newApiBalanceWholeDollars,
          },
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: result.success || !!result.uncertain,
      message: result.message,
      uncertain: result.uncertain,
      data: {
        newBalance: balance,
        pointsGained: result.pointsGained,
        newApiBalanceDollars: result.newApiBalanceDollars,
        newApiBalanceWholeDollars: result.newApiBalanceWholeDollars,
      },
    });
  },
  { unauthorizedMessage: '请先登录' },
);
