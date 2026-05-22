import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { plantCrop, getFarmStatus } from '@/lib/farm-v2';
import type { CropIdV2 } from '@/lib/types/farm-v2';

export const POST = withUserRateLimit(
  'farm:action',
  async (req: NextRequest, user) => {
    try {
      const body = await req.json().catch(() => null) as { plotIndex?: number; cropId?: CropIdV2 } | null;
      if (!body || typeof body.plotIndex !== 'number' || typeof body.cropId !== 'string') {
        return NextResponse.json({ success: false, message: '参数无效' }, { status: 400 });
      }
      const r = await plantCrop(user.id, body.plotIndex, body.cropId as CropIdV2);
      if (!r.ok) return NextResponse.json({ success: false, message: r.msg }, { status: 400 });
      const data = await getFarmStatus(user.id);
      return NextResponse.json({ success: true, data, balance: r.balance });
    } catch (e) {
      console.error('farm v2 plant error:', e);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
