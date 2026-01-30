import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { exchangeItem } from '@/lib/store';
import { getUserPoints } from '@/lib/points';

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const { itemId, quantity } = await request.json();
    
    if (!itemId || typeof itemId !== 'string') {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    const qty = quantity === undefined ? 1 : Number(quantity);
    if (!Number.isSafeInteger(qty) || qty < 1) {
      return NextResponse.json({ error: '数量参数错误' }, { status: 400 });
    }

    const result = await exchangeItem(user.id, itemId, qty);
    
    if (!result.success) {
      return NextResponse.json({ 
        success: false, 
        message: result.message 
      }, { status: 400 });
    }

    // 返回更新后的积分余额
    const newBalance = await getUserPoints(user.id);

    return NextResponse.json({
      success: true,
      message: result.message,
      data: {
        log: result.log,
        newBalance,
      },
    });
  } catch (error) {
    console.error('Exchange error:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
