import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { sellStolenEcoPrizeOnBlackMarket } from '@/lib/eco';
import type { EcoPrizeKey } from '@/lib/types/eco';

export const POST = withUserRateLimit('store:exchange', async (request: NextRequest, user) => {
  let body: { key?: unknown };
  try {
    body = (await request.json()) as { key?: unknown };
  } catch {
    return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
  }

  if (typeof body.key !== 'string') {
    return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
  }

  const result = await sellStolenEcoPrizeOnBlackMarket(user.id, body.key as EcoPrizeKey);
  if (!result.ok) {
    return NextResponse.json({ success: false, message: result.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    data: {
      prizeKey: result.prizeKey,
      quantitySold: result.quantitySold,
      price: result.price,
      pointsEarned: result.pointsEarned,
      status: result.data,
    },
  });
});
