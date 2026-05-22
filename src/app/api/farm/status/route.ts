import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { getFarmStatus } from '@/lib/farm-v2';

export const POST = withUserRateLimit(
  'farm:action',
  async (_req: NextRequest, user) => {
    try {
      const data = await getFarmStatus(user.id);
      return NextResponse.json({ success: true, data });
    } catch (e) {
      console.error('farm v2 status error:', e);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);

export const GET = POST;
