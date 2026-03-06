import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { CARD_DRAW_PRICE } from '@/lib/cards/constants';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { addCardDraws } from '@/lib/kv';
import { addPoints, deductPoints } from '@/lib/points';

export async function POST() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  // 速率限制检查
  const rateLimitResult = await checkRateLimit(user.id.toString(), {
    prefix: "ratelimit:cards:purchase",
  });
  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult);
  }

  const userId = user.id;
  const amount = CARD_DRAW_PRICE;
  const drawAward = 1;

  try {
    const deductResult = await deductPoints(
      userId,
      amount,
      'exchange',
      `购买动物卡抽卡次数 x${drawAward}`,
    );

    if (!deductResult.success) {
      return NextResponse.json({
        success: false,
        message: deductResult.message ?? '积分不足',
        balance: deductResult.balance,
      });
    }

    try {
      const drawResult = await addCardDraws(userId, drawAward);

      return NextResponse.json({
        success: true,
        message: `成功购买 ${drawAward} 次抽卡机会`,
        newBalance: deductResult.balance,
        drawsAvailable: drawResult.drawsAvailable,
      });
    } catch (awardError) {
      console.error('Award card draw failed, refunding points:', awardError);

      try {
        await addPoints(
          userId,
          amount,
          'exchange_refund',
          `购买动物卡抽卡次数失败退款 x${drawAward}`,
        );
      } catch (refundError) {
        console.error('Refund points failed after card purchase error:', refundError);
        return NextResponse.json(
          { success: false, message: '购买失败，且自动退款失败，请联系管理员处理' },
          { status: 500 },
        );
      }

      return NextResponse.json(
        { success: false, message: '购买失败，积分已自动退回' },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error('Purchase card draw error:', error);
    return NextResponse.json({ success: false, message: '服务器内部错误' }, { status: 500 });
  }
}
