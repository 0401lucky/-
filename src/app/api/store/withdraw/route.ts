import { NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { executeWithdraw, MIN_WITHDRAW_POINTS, recoverWalletTransactions } from '@/lib/wallet';
import { getUserPoints } from '@/lib/points';

// POST /api/store/withdraw
// body: { points: number }
// 将指定积分数提现为账户额度（10 积分 = $1，按阶梯收手续费）
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

    const raw = (body as Record<string, unknown>).points;
    const points = Number(raw);

    if (!Number.isFinite(points) || !Number.isInteger(points) || points <= 0) {
      return NextResponse.json(
        { success: false, message: '积分数量必须为正整数' },
        { status: 400 },
      );
    }
    if (points < MIN_WITHDRAW_POINTS) {
      return NextResponse.json(
        { success: false, message: `最低提现 ${MIN_WITHDRAW_POINTS} 积分` },
        { status: 400 },
      );
    }

    await recoverWalletTransactions(user.id).catch((error) => {
      console.error('wallet withdraw recovery failed:', error);
    });

    const result = await executeWithdraw(user.id, points);

    const balance = result.balance ?? (await getUserPoints(user.id));

    if (!result.success && !result.uncertain) {
      return NextResponse.json(
        {
          success: false,
          message: result.message,
          data: { newBalance: balance },
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
        dollars: result.dollars,
        feePoints: result.feePoints,
      },
    });
  },
  { unauthorizedMessage: '请先登录' },
);
