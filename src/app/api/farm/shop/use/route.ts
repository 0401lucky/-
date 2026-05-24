import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { useItemWithStatus } from '@/lib/farm-v2';
import type { ShopItemKey } from '@/lib/types/farm-v2';

export const POST = withUserRateLimit(
  'farm:action',
  async (req: NextRequest, user) => {
    try {
      const body = await req.json().catch(() => null) as { key?: ShopItemKey; plotIndex?: number } | null;
      if (!body || typeof body.key !== 'string') {
        return NextResponse.json({ success: false, message: '参数无效' }, { status: 400 });
      }
      const r = await useItemWithStatus(user.id, body.key as ShopItemKey, body.plotIndex);
      if (!r.ok) return NextResponse.json({ success: false, message: r.msg }, { status: 400 });
      return NextResponse.json({ success: true, data: r.data });
    } catch (e) {
      console.error('farm v2 shop use error:', e);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
