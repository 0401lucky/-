import { NextResponse } from 'next/server';
import { listUserNotifications } from '@/lib/notifications';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const GET = withUserRateLimit(
  'notifications:list',
  async (request, user) => {
    try {
      const { searchParams } = new URL(request.url);
      const pageRaw = Number(searchParams.get('page') ?? 1);
      const limitRaw = Number(searchParams.get('limit') ?? 20);
      const typeRaw = searchParams.get('type');

      const page = Number.isFinite(pageRaw) ? pageRaw : 1;
      const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
      const type = typeRaw && typeRaw !== 'all' ? typeRaw : undefined;

      const result = await listUserNotifications(user.id, {
        page,
        limit,
        type: type as
          | 'system'
          | 'announcement'
          | 'feedback_reply'
          | 'lottery_win'
          | 'raffle_win'
          | undefined,
      });

      return NextResponse.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('List notifications error:', error);
      return NextResponse.json({ success: false, message: '获取通知失败' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' }
);
