import { NextResponse } from 'next/server';
import { getUserNotificationUnreadCount } from '@/lib/notifications';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const GET = withUserRateLimit(
  'notifications:list',
  async (_request, user) => {
    try {
      const unreadCount = await getUserNotificationUnreadCount(user.id);
      return NextResponse.json({
        success: true,
        data: { unreadCount },
      });
    } catch (error) {
      console.error('Get unread notification count error:', error);
      return NextResponse.json({ success: false, message: '获取未读数量失败' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' }
);
