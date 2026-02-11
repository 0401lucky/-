// src/app/api/games/match3/submit/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { submitMatch3Result } from '@/lib/match3';
import { withUserRateLimit } from '@/lib/rate-limit';
import type { Match3GameResultSubmit } from '@/lib/match3';

export const POST = withUserRateLimit('game:submit', async (request: NextRequest, user) => {
  try {
    const body = (await request.json()) as Match3GameResultSubmit;

    if (!body.sessionId || !Array.isArray(body.moves)) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }

    const result = await submitMatch3Result(user.id, body);
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
    console.error('Submit match3 result error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
});
