import { NextRequest, NextResponse } from 'next/server';
import { submitWhackMoleResult, type WhackMoleResultSubmit } from '@/lib/whack-mole';
import { withUserRateLimit } from '@/lib/rate-limit';

export const POST = withUserRateLimit('game:submit', async (request: NextRequest, user) => {
  try {
    const body = (await request.json()) as WhackMoleResultSubmit;

    if (!body.sessionId) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }

    const result = await submitWhackMoleResult(user.id, body);
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
    console.error('Submit whack mole result error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
});
