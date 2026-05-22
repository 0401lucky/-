import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { waterAllPlots, getFarmStatus } from '@/lib/farm-v2';

export const POST = withUserRateLimit(
  'farm:action',
  async (_req: NextRequest, user) => {
    try {
      const r = await waterAllPlots(user.id);
      if (!r.ok) return NextResponse.json({ success: false, message: r.msg }, { status: 400 });
      const data = await getFarmStatus(user.id);
      return NextResponse.json({ success: true, data, count: r.count });
    } catch (e) {
      console.error('farm v2 water-all error:', e);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
