import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { buyItemWithStatus } from '@/lib/farm-v2';
import type { ShopItemKey } from '@/lib/types/farm-v2';

export const POST = withUserRateLimit(
  'farm:action',
  async (req: NextRequest, user) => {
    try {
      const body = await req.json().catch(() => null) as { key?: ShopItemKey; qty?: number } | null;
      if (!body || typeof body.key !== 'string') {
        return NextResponse.json({ success: false, message: '参数无效' }, { status: 400 });
      }
      const qty = typeof body.qty === 'number' && body.qty > 0 ? Math.floor(body.qty) : 1;
      const r = await buyItemWithStatus(user.id, body.key as ShopItemKey, qty);
      if (!r.ok) return NextResponse.json({ success: false, message: r.msg }, { status: 400 });
      return NextResponse.json({ success: true, data: r.data, balance: r.balance });
    } catch (e) {
      console.error('farm v2 shop buy error:', e);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
