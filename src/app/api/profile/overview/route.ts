import { NextResponse } from 'next/server';
import { getProfileOverview } from '@/lib/profile';
import { withUserRateLimit } from '@/lib/rate-limit';
import {
  buildKvUnavailablePayload,
  getKvErrorInsight,
  KV_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from '@/lib/kv';

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
      const kvInsight = getKvErrorInsight(error);
      if (kvInsight.isUnavailable) {
        return NextResponse.json(
          buildKvUnavailablePayload('个人主页数据服务暂时不可用，请稍后重试'),
          {
            status: 503,
            headers: {
              'Retry-After': KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
            },
          }
        );
      }

      return NextResponse.json(
        { success: false, message: '获取个人主页数据失败' },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);
