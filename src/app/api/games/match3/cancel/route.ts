// src/app/api/games/match3/cancel/route.ts

import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { cancelMatch3Game } from '@/lib/match3';

export async function POST() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const result = await cancelMatch3Game(user.id);
    if (!result.success) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: '游戏已取消' });
  } catch (error) {
    console.error('Cancel match3 game error:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

