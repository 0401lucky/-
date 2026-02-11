import { NextRequest, NextResponse } from 'next/server';
import { submitLinkGameResult } from '@/lib/linkgame-server';
import { withUserRateLimit } from '@/lib/rate-limit';
import type { LinkGameResultSubmit } from '@/lib/types/game';

export const POST = withUserRateLimit('game:submit', async (request: NextRequest, user) => {
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
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
});
