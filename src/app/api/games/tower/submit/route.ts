// src/app/api/games/tower/submit/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { submitTowerResult } from '@/lib/tower';
import { withUserRateLimit } from '@/lib/rate-limit';
import type { TowerGameResultSubmit } from '@/lib/tower';

export const POST = withUserRateLimit('game:submit', async (request: NextRequest, user) => {
  try {
    const body = (await request.json()) as TowerGameResultSubmit;

    if (!body.sessionId || !Array.isArray(body.choices)) {
      return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
    }

    const result = await submitTowerResult(user.id, body);
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
    console.error('Submit tower result error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
});
