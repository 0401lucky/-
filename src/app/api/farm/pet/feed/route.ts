import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { feedPetAction, getFarmStatus } from '@/lib/farm-v2';

export const POST = withUserRateLimit(
  'farm:action',
  async (req: NextRequest, user) => {
    try {
      const body = await req.json().catch(() => null) as { kind?: 'normal' | 'premium' } | null;
      if (!body || (body.kind !== 'normal' && body.kind !== 'premium')) {
        return NextResponse.json({ success: false, message: '参数无效' }, { status: 400 });
      }
      const r = await feedPetAction(user.id, body.kind);
      if (!r.ok) return NextResponse.json({ success: false, message: r.msg }, { status: 400 });
      const data = await getFarmStatus(user.id);
      return NextResponse.json({ success: true, data, balance: r.balance });
    } catch (e) {
      console.error('farm v2 pet feed error:', e);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
