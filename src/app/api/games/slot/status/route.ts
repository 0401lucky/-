import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSlotStatus } from '@/lib/slot';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  try {
    const data = await getSlotStatus(user.id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Get slot status error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}

