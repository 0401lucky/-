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

      const message =
        error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();

      if (message.includes('d1 binding kv_db not available')) {
        return NextResponse.json(
          { success: false, message: '站点数据服务未绑定（KV_DB），请联系管理员检查 Cloudflare 绑定配置' },
          { status: 503 }
        );
      }

      if (message.includes('no such table')) {
        return NextResponse.json(
          { success: false, message: '站点数据表尚未初始化，请稍后刷新（若持续失败请联系管理员）' },
          { status: 503 }
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
