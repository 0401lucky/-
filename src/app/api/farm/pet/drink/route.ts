import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { drinkPetAction, getFarmStatus } from '@/lib/farm-v2';
import type { ShopItemKey } from '@/lib/types/farm-v2';

export const POST = withUserRateLimit(
  'farm:action',
  async (req: NextRequest, user) => {
    try {
      const body = await req.json().catch(() => null) as { itemKey?: ShopItemKey } | null;
      const r = await drinkPetAction(user.id, body?.itemKey);
      if (!r.ok) return NextResponse.json({ success: false, message: r.msg }, { status: 400 });
      const data = await getFarmStatus(user.id);
      return NextResponse.json({ success: true, data });
    } catch (e) {
      console.error('farm v2 pet drink error:', e);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
