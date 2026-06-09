import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { claimEcoPrize } from '@/lib/eco';

export const POST = withUserRateLimit('game:action', async (request: NextRequest, user) => {
  let body: { prizeId?: unknown };
  try {
    body = (await request.json()) as { prizeId?: unknown };
  } catch {
    return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
  }

  if (typeof body.prizeId !== 'string') {
    return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
  }

  const result = await claimEcoPrize(user.id, body.prizeId);
  if (!result.ok) {
    return NextResponse.json({ success: false, message: result.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    data: {
      prizeKey: result.prizeKey,
      status: result.data,
    },
  });
});
