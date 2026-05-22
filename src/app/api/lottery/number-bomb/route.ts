import { NextResponse } from 'next/server';
import { getNumberBombState } from '@/lib/number-bomb';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const GET = withUserRateLimit(
  'lottery:number-bomb:state',
  async (_request, user) => {
    try {
      const state = await getNumberBombState(user.id);
      return NextResponse.json({ success: true, data: state });
    } catch (error) {
      console.error('Get number bomb state error:', error);
      return NextResponse.json(
        { success: false, message: '获取数字炸弹状态失败' },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
