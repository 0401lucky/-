import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { cancelLinkGame } from '@/lib/linkgame-server';

export async function POST() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const result = await cancelLinkGame(user.id);
    if (!result.success) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: '游戏已取消' });
  } catch (error) {
    console.error('Cancel linkgame error:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

