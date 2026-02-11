import { NextResponse } from 'next/server';
import { exchangeItem } from '@/lib/store';
import { getUserPoints } from '@/lib/points';
import { withUserRateLimit } from '@/lib/rate-limit';

export const POST = withUserRateLimit('store:exchange', async (request, user) => {
  try {
    const { itemId, quantity } = await request.json();
    
    if (!itemId || typeof itemId !== 'string') {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }

    const qty = quantity === undefined ? 1 : Number(quantity);
    if (!Number.isSafeInteger(qty) || qty < 1) {
      return NextResponse.json({ success: false, message: '数量参数错误' }, { status: 400 });
    }

    const result = await exchangeItem(user.id, itemId, qty);
    
    if (!result.success && !result.uncertain) {
      return NextResponse.json({ 
        success: false, 
        uncertain: result.uncertain,
        message: result.message 
      }, { status: 400 });
    }

    // 返回更新后的积分余额
    const newBalance = await getUserPoints(user.id);

    return NextResponse.json({
      success: result.success || !!result.uncertain,
      message: result.message,
      uncertain: result.uncertain,
      data: {
        log: result.log,
        newBalance,
      },
    });
  } catch (error) {
    console.error('Exchange item error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
});

