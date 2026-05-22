import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { executeSteal, getFarmStatus } from '@/lib/farm-v2';

export const POST = withUserRateLimit(
  'farm:action',
  async (req: NextRequest, user) => {
    try {
      const body = await req.json().catch(() => null) as { targetUserId?: number; landIndex?: number } | null;
      if (!body || typeof body.targetUserId !== 'number' || typeof body.landIndex !== 'number') {
        return NextResponse.json({ success: false, message: '参数无效' }, { status: 400 });
      }
      const r = await executeSteal(user.id, body.targetUserId, body.landIndex);
      if (!r.ok) return NextResponse.json({ success: false, message: r.msg }, { status: 400 });
      const data = await getFarmStatus(user.id);
      return NextResponse.json({
        success: true, data,
        steal: { success: r.success, amount: r.amount, lucky: r.lucky, balance: r.balance },
      });
    } catch (e) {
      console.error('farm v2 steal do error:', e);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
