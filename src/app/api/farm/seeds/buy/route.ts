import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { buySeeds, getFarmStatus } from '@/lib/farm-v2';
import type { CropIdV2 } from '@/lib/types/farm-v2';

export const POST = withUserRateLimit(
  'farm:action',
  async (req: NextRequest, user) => {
    try {
      const body = await req.json().catch(() => null) as { cropId?: CropIdV2; qty?: number } | null;
      if (!body || typeof body.cropId !== 'string') {
        return NextResponse.json({ success: false, message: '参数无效' }, { status: 400 });
      }
      const qty = typeof body.qty === 'number' && body.qty > 0 ? Math.floor(body.qty) : 1;
      const r = await buySeeds(user.id, body.cropId as CropIdV2, qty);
      if (!r.ok) return NextResponse.json({ success: false, message: r.msg }, { status: 400 });
      const data = await getFarmStatus(user.id);
      return NextResponse.json({ success: true, data, balance: r.balance });
    } catch (e) {
      console.error('farm v2 seeds buy error:', e);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
