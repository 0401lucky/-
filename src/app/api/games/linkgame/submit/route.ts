import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { submitLinkGameResult } from '@/lib/linkgame-server';
import type { LinkGameResultSubmit } from '@/lib/types/game';

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const body = await request.json() as LinkGameResultSubmit;

    if (!body.sessionId || !Array.isArray(body.moves)) {
      return NextResponse.json({
        success: false,
        message: '参数错误',
      }, { status: 400 });
    }

    const result = await submitLinkGameResult(user.id, body);

    if (!result.success) {
      return NextResponse.json({
        success: false,
        message: result.message,
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: {
        record: result.record,
        pointsEarned: result.pointsEarned,
      },
    });
  } catch (error) {
    console.error('Submit linkgame result error:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
