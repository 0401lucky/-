import { NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { executeTopup, MIN_TOPUP_DOLLARS } from '@/lib/wallet';
import { getUserPoints } from '@/lib/points';

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

    const result = await executeTopup(user.id, dollars);

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
        pointsGained: result.pointsGained,
      },
    });
  },
  { unauthorizedMessage: '请先登录' },
);
