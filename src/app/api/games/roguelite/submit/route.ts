import { NextRequest, NextResponse } from 'next/server';
import { submitRogueliteResult } from '@/lib/roguelite';
import { withUserRateLimit } from '@/lib/rate-limit';
import type { RogueliteGameResultSubmit } from '@/lib/roguelite';

export const POST = withUserRateLimit('game:submit', async (request: NextRequest, user) => {
  try {
    const body = (await request.json()) as RogueliteGameResultSubmit;
    const result = await submitRogueliteResult(user.id, body);
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
    console.error('Submit roguelite result error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
});
