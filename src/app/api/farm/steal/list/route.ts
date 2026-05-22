import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { listStealCandidates } from '@/lib/farm-v2';

export const GET = withUserRateLimit(
  'farm:action',
  async (_req: NextRequest, user) => {
    try {
      const list = await listStealCandidates(user.id, 8);
      return NextResponse.json({ success: true, data: { candidates: list } });
    } catch (e) {
      console.error('farm v2 steal list error:', e);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
