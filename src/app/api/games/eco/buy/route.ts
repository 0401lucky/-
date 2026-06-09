import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { buyEcoItem, buyEcoUpgrade } from '@/lib/eco';
import type { EcoItemKey, EcoUpgradeKey } from '@/lib/types/eco';

export const POST = withUserRateLimit('store:exchange', async (request: NextRequest, user) => {
  let body: { type?: unknown; key?: unknown };
  try {
    body = (await request.json()) as { type?: unknown; key?: unknown };
  } catch {
    return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
  }

  const { type, key } = body;
  if (typeof key !== 'string' || (type !== 'upgrade' && type !== 'item')) {
    return NextResponse.json({ success: false, message: '参数错误' }, { status: 400 });
  }

  const result = type === 'upgrade'
    ? await buyEcoUpgrade(user.id, key as EcoUpgradeKey)
    : await buyEcoItem(user.id, key as EcoItemKey);

  if (!result.ok) {
    return NextResponse.json({ success: false, message: result.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, data: { status: result.data } });
});
