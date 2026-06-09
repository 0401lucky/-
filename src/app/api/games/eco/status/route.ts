import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getEcoStatus } from '@/lib/eco';

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  try {
    const allowOnlinePrizes = request.nextUrl.searchParams.get('online') === '1';
    const data = await getEcoStatus(user.id, { allowOnlinePrizes });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Get eco status error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
