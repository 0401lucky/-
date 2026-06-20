import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { stealEcoPublicPrize } from '@/lib/eco';

export const POST = withUserRateLimit('game:action', async (request: NextRequest, user) => {
  let body: { entryId?: unknown; message?: unknown };
  try {
    body = (await request.json()) as { entryId?: unknown; message?: unknown };
  } catch {
    return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
  }

  if (typeof body.entryId !== 'string' || typeof body.message !== 'string') {
    return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
  }

  const result = await stealEcoPublicPrize(user.id, body.entryId, body.message);
  if (!result.ok) {
    return NextResponse.json({ success: false, message: result.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, data: { status: result.data } });
});
