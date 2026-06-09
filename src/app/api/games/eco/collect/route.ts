import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { collectEcoTrash } from '@/lib/eco';

export const POST = withUserRateLimit('game:action', async (request: NextRequest, user) => {
  let drags = 1;
  try {
    const body = (await request.json()) as { drags?: unknown };
    if (typeof body?.drags === 'number') drags = body.drags;
  } catch {
    // 容忍空 body，默认回收 1 次
  }

  const result = await collectEcoTrash(user.id, drags);
  if (!result.ok) {
    return NextResponse.json({ success: false, message: result.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    data: {
      cleared: result.cleared,
      pointsEarned: result.pointsEarned,
      status: result.data,
    },
  });
});
