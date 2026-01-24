// src/app/api/games/match3/submit/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { submitMatch3Result } from '@/lib/match3';
import type { Match3GameResultSubmit } from '@/lib/match3';

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

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
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

