// src/app/api/games/tower/cancel/route.ts

import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { cancelTowerGame } from '@/lib/tower';

export async function POST() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  try {
    const result = await cancelTowerGame(user.id);
    if (!result.success) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: '游戏已取消' });
  } catch (error) {
    console.error('Cancel tower game error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
