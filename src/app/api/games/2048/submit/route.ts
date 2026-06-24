import { NextRequest, NextResponse } from 'next/server';
import { submitGame2048Result, type Game2048ResultSubmit } from '@/lib/game-2048';
import { withUserRateLimit } from '@/lib/rate-limit';

export const POST = withUserRateLimit('game:submit', async (request: NextRequest, user) => {
  try {
    const body = (await request.json()) as Game2048ResultSubmit;
    if (!body || typeof body.sessionId !== 'string' || !Array.isArray(body.moves)) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }

    const result = await submitGame2048Result(user.id, body);
    if (!result.success) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: {
        record: result.record,
        pointsEarned: result.pointsEarned,
      },
    });
  } catch (error) {
    console.error('Submit 2048 result error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
});
