import { NextResponse } from 'next/server';
import { getProfileOverview } from '@/lib/profile';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const GET = withUserRateLimit(
  'profile:overview',
  async (_request, user) => {
    try {
      const data = await getProfileOverview({
        id: user.id,
        username: user.username,
      });

      return NextResponse.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('Get profile overview error:', error);
      return NextResponse.json(
        { success: false, message: '获取个人主页数据失败' },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);
