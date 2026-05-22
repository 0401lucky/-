import { NextResponse } from 'next/server';
import { placeNumberBombBet } from '@/lib/number-bomb';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = withUserRateLimit(
  'lottery:number-bomb:bet',
  async (request, user) => {
    try {
      const body = await request.json().catch(() => ({}));
      const result = await placeNumberBombBet(
        { id: user.id, username: user.username },
        {
          selectedNumber: body?.selectedNumber,
          multiplier: body?.multiplier,
        },
      );

      if (!result.success) {
        return NextResponse.json(
          { success: false, message: result.message, balance: result.balance },
          { status: 400 },
        );
      }

      return NextResponse.json({
        success: true,
        message: result.message,
        bet: result.bet,
        balance: result.balance,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '下注失败';
      console.error('Number bomb bet error:', error);
      return NextResponse.json(
        { success: false, message },
        { status: 400 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
