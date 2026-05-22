import { NextResponse } from 'next/server';
import { cancelNumberBombBet } from '@/lib/number-bomb';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = withUserRateLimit(
  'lottery:number-bomb:cancel',
  async (_request, user) => {
    try {
      const result = await cancelNumberBombBet(user.id);
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
      console.error('Number bomb cancel error:', error);
      return NextResponse.json(
        { success: false, message: '取消失败' },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
