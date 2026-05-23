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
      const rawMessage = error instanceof Error ? error.message : '取消失败';
      const message = rawMessage.startsWith('LOCK_TIMEOUT:')
        ? '积分账户正在处理上一笔操作，请稍后再试'
        : '取消失败';
      console.error('Number bomb cancel error:', error);
      return NextResponse.json(
        { success: false, message },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
